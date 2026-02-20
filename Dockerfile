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
COPY packages/docs/package.json packages/docs/

RUN npm ci

# Copy source for shared, packs, hub, dashboard, docs
COPY packages/shared/src packages/shared/src
COPY packages/packs/src packages/packs/src
COPY packages/hub/src packages/hub/src
COPY packages/dashboard/src packages/dashboard/src
COPY packages/dashboard/public packages/dashboard/public
COPY packages/dashboard/index.html packages/dashboard/index.html
COPY packages/dashboard/vite.config.ts packages/dashboard/vite.config.ts
COPY packages/dashboard/postcss.config.mjs packages/dashboard/postcss.config.mjs
COPY packages/dashboard/tsconfig.json packages/dashboard/tsconfig.json
COPY packages/docs/src packages/docs/src
COPY packages/docs/astro.config.mjs packages/docs/astro.config.mjs
COPY packages/docs/tsconfig.json packages/docs/tsconfig.json

RUN npx turbo build --filter=@sonde/hub --filter=@sonde/dashboard --filter=@sonde/docs

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
COPY packages/docs/package.json packages/docs/

RUN npm ci --omit=dev && apk del python3 make g++

# Copy compiled output from builder
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/packs/dist packages/packs/dist
COPY --from=builder /app/packages/hub/dist packages/hub/dist
COPY --from=builder /app/packages/dashboard/dist packages/dashboard/dist
COPY --from=builder /app/packages/docs/dist packages/docs/dist

# SQLite data directory
RUN mkdir -p /data

# Run as non-root user
RUN addgroup -S sonde && adduser -S sonde -G sonde
RUN chown -R sonde:sonde /data /app

ENV NODE_ENV=production
ENV SONDE_DB_PATH=/data/sonde.db

EXPOSE 3000

USER sonde

CMD ["node", "packages/hub/dist/index.js"]
