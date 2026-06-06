FROM node:26-alpine AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:26-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Production deps only — devDependencies (Playwright, ESLint, Vitest…) never reach
# the runtime image. adapter-node's build/ externalizes runtime `dependencies`.
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --prod --frozen-lockfile && pnpm store prune

COPY --from=builder /app/build build/

# Drop root: the node image ships an unprivileged `node` user. The runtime only reads
# build/ + node_modules and listens on a high port, so no root is needed.
USER node

EXPOSE 3000
CMD ["node", "build"]
