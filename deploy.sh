#!/usr/bin/env bash
set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────────────────
SERVICE_NAME="save-the-sun"
REGION="${REGION:-us-east1}"
PORT="3000"
SA_NAME="${SERVICE_NAME}-run"
SECRET_GEMINI="SAVE_THE_SUN_GEMINI_API_KEY"

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
    --quiet
  echo "  Created"
else
  echo "  Exists"
fi

# Keep only the 3 most recent versions; GC the rest. Stops images piling up forever.
echo "» Applying cleanup policy (keep 3 most recent)..."
gcloud artifacts repositories set-cleanup-policies "${REPO_NAME}" \
  --location="${REGION}" \
  --policy=cleanup-policy.json \
  --no-dry-run \
  --quiet

# ─── Build ──────────────────────────────────────────────────────────────────────
IMAGE="${REPO_PATH}/${SERVICE_NAME}:latest"
echo "» Building image: ${IMAGE}"
gcloud builds submit --tag "${IMAGE}" --quiet

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
  --timeout 60 \
  --cpu-boost \
  --set-secrets="GEMINI_API_KEY=${SECRET_GEMINI}:latest" \
  --quiet

# ─── Smoke test ──────────────────────────────────────────────────────────────────
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format="value(status.url)")
echo "» Smoke test: ${SERVICE_URL}/"
RETRIES=4
for i in $(seq 1 $RETRIES); do
  if curl -sf --max-time 10 "${SERVICE_URL}/" >/dev/null 2>&1; then
    echo "  PASS — service is healthy"
    break
  fi
  if [[ "$i" -eq "$RETRIES" ]]; then
    echo "  WARN — no healthy response after ${RETRIES} attempts. Check logs:"
    echo "    gcloud run services logs read ${SERVICE_NAME} --region=${REGION} --limit=20"
  else
    echo "  Attempt ${i}/${RETRIES} failed, retrying in 5s..."
    sleep 5
  fi
done

echo ""
echo "${RULE}"
echo "  Cloud Run : ${SERVICE_URL}"
echo "${RULE}"
