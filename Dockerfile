# ─── Stage 1: Build (needs devDependencies: vite, svelte, adapter-node) ──────
FROM node:26-alpine AS builder

WORKDIR /app

# pnpm pinned to the lockfile's major so --frozen-lockfile never drifts.
RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# ─── Stage 2: Production runtime (prod deps only) ────────────────────────────
FROM node:26-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Production deps only — devDependencies (Playwright, ESLint, Vitest…) never reach
# the runtime image. adapter-node externalizes runtime `dependencies`, so they
# must exist in node_modules here.
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune

COPY --from=builder /app/build build/

# Drop root: the node image ships an unprivileged `node` user. The runtime only
# reads build/ + node_modules and listens on a high port, so root is unneeded.
USER node

# Cloud Run injects PORT; adapter-node reads it. 3000 is the local default.
ENV PORT=3000
EXPOSE 3000
CMD ["node", "build"]
