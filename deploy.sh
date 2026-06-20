#!/usr/bin/env bash
set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────────────────
SERVICE_NAME="save-the-sun"
REGION="${REGION:-us-east1}"
PORT="3000"
SA_NAME="${SERVICE_NAME}-run"
SECRET_GEMINI="SAVE_THE_SUN_GEMINI_API_KEY"
# Billing labels stamped on every resource so spend is attributable per-app in the billing console.
RESOURCE_LABELS="app=${SERVICE_NAME},managed-by=deploy-script"

# Production rate-limit ceilings (per minute, per Cloud Run instance — at most 2 run). Generous per
# SESSION so the Oracle never throttles mid-game; the GLOBAL value is the abuse backstop and should sit
# at or below the key's real per-model RPM. The billing cap is the hard spend stop. Export any single
# var before `make deploy` to override just that one without touching this block.
PROD_LIMITS=(
  TTS_SESSION_LIMIT=150 TTS_GLOBAL_LIMIT=450
  STT_SESSION_LIMIT=15 STT_GLOBAL_LIMIT=60
  ASK_SESSION_LIMIT=12 ASK_GLOBAL_LIMIT=48
  LITE_SESSION_LIMIT=90 LITE_GLOBAL_LIMIT=300
)

RULE="═══════════════════════════════════════════════════════════"

# ─── Preflight ──────────────────────────────────────────────────────────────────
command -v gcloud >/dev/null 2>&1 || {
  echo "ERROR: gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install" >&2
  exit 1
}

# Project follows the currently signed-in gcloud config (override with PROJECT_ID=…).
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
[[ -n "$PROJECT_ID" ]] || {
  echo "ERROR: No GCP project. Run: gcloud config set project <ID>" >&2
  exit 1
}

# Pin every gcloud call in this run to PROJECT_ID without mutating the user's
# persistent config — covers commands that don't take an explicit --project.
export CLOUDSDK_CORE_PROJECT="${PROJECT_ID}"

# GEMINI_API_KEY from env, else from .env — needed to seed Secret Manager.
if [[ -z "${GEMINI_API_KEY:-}" ]] && [[ -f .env ]]; then
  GEMINI_API_KEY=$(grep '^GEMINI_API_KEY=' .env | cut -d= -f2- || true)
fi

echo "${RULE}"
echo "  ${SERVICE_NAME} → ${PROJECT_ID} / ${REGION}"
echo "${RULE}"

# ─── Enable required APIs ───────────────────────────────────────────────────────
echo "» Enabling GCP APIs..."
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  --quiet

# ─── Service account (least-privilege) ──────────────────────────────────────────
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
echo "» Service account: ${SA_EMAIL}"
if ! gcloud iam service-accounts describe "${SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SA_NAME}" \
    --display-name="Save the Sun Cloud Run" \
    --quiet
  echo "  Created"
else
  echo "  Exists"
fi

# ─── Secret Manager: Gemini API key ─────────────────────────────────────────────
echo "» Secret: ${SECRET_GEMINI}"
if ! gcloud secrets describe "${SECRET_GEMINI}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  [[ -n "${GEMINI_API_KEY:-}" ]] || {
    echo "  ERROR: secret '${SECRET_GEMINI}' missing and GEMINI_API_KEY not set." >&2
    echo "         Set it in .env / export it, or create the secret manually." >&2
    exit 1
  }
  gcloud secrets create "${SECRET_GEMINI}" --replication-policy="automatic" --project="${PROJECT_ID}" --quiet
  printf '%s' "${GEMINI_API_KEY}" | gcloud secrets versions add "${SECRET_GEMINI}" --data-file=- --project="${PROJECT_ID}" --quiet
  echo "  Created + seeded from environment"
else
  echo "  Exists (leaving value untouched)"
fi

# SA reads only this secret, nothing else.
gcloud secrets add-iam-policy-binding "${SECRET_GEMINI}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" \
  --project="${PROJECT_ID}" \
  --quiet >/dev/null

# ─── Artifact Registry + cleanup policy ─────────────────────────────────────────
REPO_NAME="${SERVICE_NAME}"
REPO_PATH="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}"
echo "» Artifact Registry: ${REPO_NAME}"
if ! gcloud artifacts repositories describe "${REPO_NAME}" \
  --location="${REGION}" --format="value(name)" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${REPO_NAME}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Docker images for ${SERVICE_NAME}" \
    --labels="${RESOURCE_LABELS}" \
    --quiet
  echo "  Created"
else
  echo "  Exists"
fi

# Label idempotently so a repo created before labels existed still gets attributed.
gcloud artifacts repositories update "${REPO_NAME}" --location="${REGION}" \
  --update-labels="${RESOURCE_LABELS}" --quiet >/dev/null 2>&1 || true

# Keep only the 3 most recent versions; GC the rest. Stops images piling up forever.
echo "» Applying cleanup policy (keep 3 most recent)..."
gcloud artifacts repositories set-cleanup-policies "${REPO_NAME}" \
  --location="${REGION}" \
  --policy=cleanup-policy.json \
  --no-dry-run \
  --quiet

# ─── Build (immutable SHA tag + a floating :latest) ─────────────────────────────
# An immutable per-commit tag makes each deploy a distinct image the cleanup policy can age out —
# not a single :latest that silently orphans the prior digest on every build.
GIT_SHA="$(git rev-parse --short=12 HEAD 2>/dev/null || echo manual)"
[[ -z "$(git status --porcelain 2>/dev/null)" ]] || GIT_SHA="${GIT_SHA}-dirty"
IMAGE="${REPO_PATH}/${SERVICE_NAME}:${GIT_SHA}"
LATEST="${REPO_PATH}/${SERVICE_NAME}:latest"
echo "» Building image: ${IMAGE}"
gcloud builds submit --tag "${IMAGE}" --quiet
# Float :latest to this build for humans / quick rollback reference.
gcloud artifacts docker tags add "${IMAGE}" "${LATEST}" --quiet

# Build the runtime env from PROD_LIMITS: each var takes its exported shell value if set, else the prod
# default above. Every deploy sets EXPLICIT ceilings — prod never silently inherits the in-app dev
# defaults, and unsetting an override then redeploying restores the prod default (not the code default).
RUNTIME_ENV=""
for pair in "${PROD_LIMITS[@]}"; do
  var="${pair%%=*}"
  default="${pair#*=}"
  override="${!var:-}"
  RUNTIME_ENV="${RUNTIME_ENV:+${RUNTIME_ENV},}${var}=${override:-$default}"
done
echo "» Rate-limit ceilings: ${RUNTIME_ENV}"
ENV_FLAG=(--set-env-vars="${RUNTIME_ENV}")

# ─── Deploy (cost-optimized: scale to zero, small ceiling) ──────────────────────
echo "» Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --port "${PORT}" \
  --service-account "${SA_EMAIL}" \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 2 \
  --concurrency 80 \
  --timeout 60s \
  --cpu-boost \
  --labels="${RESOURCE_LABELS}" \
  "${ENV_FLAG[@]}" \
  --set-secrets="GEMINI_API_KEY=${SECRET_GEMINI}:latest" \
  --quiet

# ─── Smoke test ──────────────────────────────────────────────────────────────────
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format="value(status.url)")
echo "» Smoke test: ${SERVICE_URL}/"
SMOKE_OK=false
RETRIES=4
for i in $(seq 1 $RETRIES); do
  if curl -sf --max-time 10 "${SERVICE_URL}/" >/dev/null 2>&1; then
    echo "  PASS — service is healthy"
    SMOKE_OK=true
    break
  fi
  echo "  Attempt ${i}/${RETRIES} failed$([[ "$i" -lt "$RETRIES" ]] && echo ', retrying in 5s...')"
  [[ "$i" -lt "$RETRIES" ]] && sleep 5
done

# Fail loudly: a deploy that never served traffic is not a success.
if [[ "${SMOKE_OK}" != true ]]; then
  echo "  FAIL — service did not respond after ${RETRIES} attempts. Check logs:" >&2
  echo "    gcloud run services logs read ${SERVICE_NAME} --region=${REGION} --limit=20" >&2
  exit 1
fi

echo ""
echo "${RULE}"
echo "  Cloud Run : ${SERVICE_URL}"
echo "${RULE}"
