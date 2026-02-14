# ── Builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Native deps for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy workspace manifests + lockfile first (cache-friendly layer)
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/packs/package.json packages/packs/tsconfig.json packages/packs/
COPY packages/hub/package.json packages/hub/tsconfig.json packages/hub/
COPY packages/agent/package.json packages/agent/
COPY packages/dashboard/package.json packages/dashboard/

RUN npm ci

# Copy source for shared, packs, hub only
COPY packages/shared/src packages/shared/src
COPY packages/packs/src packages/packs/src
COPY packages/hub/src packages/hub/src

RUN npx turbo build --filter=@sonde/hub

# ── Runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine

# Install build tools, install production deps, then remove build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/packs/package.json packages/packs/
COPY packages/hub/package.json packages/hub/
COPY packages/agent/package.json packages/agent/
COPY packages/dashboard/package.json packages/dashboard/

RUN npm ci --omit=dev && apk del python3 make g++

# Copy compiled output from builder
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/packs/dist packages/packs/dist
COPY --from=builder /app/packages/hub/dist packages/hub/dist

# SQLite data directory
RUN mkdir -p /data

ENV NODE_ENV=production
ENV SONDE_DB_PATH=/data/sonde.db

EXPOSE 3000

CMD ["node", "packages/hub/dist/index.js"]
