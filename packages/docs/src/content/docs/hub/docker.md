---
title: Docker Deployment
---

The official Docker image is the recommended way to run the Sonde hub in production.

## Image

The official image is published to GitHub Container Registry:

```
ghcr.io/physikal/hub
```

Available tags:

| Tag | Description |
|---|---|
| `latest` | Latest stable release. |
| `v<version>` | Pinned to a specific version (e.g., `v0.3.0`). |
| `nightly` | Built from the `dev` branch. Not recommended for production. |

## Quick start

```bash
docker run -d \
  --name sonde-hub \
  -p 3000:3000 \
  -e SONDE_SECRET=$(openssl rand -hex 32) \
  -e SONDE_ADMIN_USER=admin \
  -e SONDE_ADMIN_PASSWORD=change-me \
  -v sonde-data:/data \
  ghcr.io/physikal/hub:latest
```

Then open `http://localhost:3000` and log in with the admin credentials you set above.

## Docker run options

A more complete example with all common options:

```bash
docker run -d \
  --name sonde-hub \
  --restart unless-stopped \
  -p 3000:3000 \
  -e SONDE_SECRET=your-secret-key \
  -e SONDE_HUB_URL=https://mcp.example.com \
  -e SONDE_ADMIN_USER=admin \
  -e SONDE_ADMIN_PASSWORD=change-me \
  -e SONDE_DB_PATH=/data/sonde.db \
  -v sonde-data:/data \
  ghcr.io/physikal/hub:latest
```

| Flag | Purpose |
|---|---|
| `--restart unless-stopped` | Auto-restart on crash or host reboot. |
| `-p 3000:3000` | Expose the hub on port 3000. Change the host port as needed. |
| `-e SONDE_SECRET=...` | Required. Encryption root of trust (at least 16 characters). |
| `-e SONDE_HUB_URL=...` | Public URL. Required for SSO callbacks and agent enrollment. |
| `-e SONDE_ADMIN_USER=...` | Bootstrap admin username. Required to access the dashboard. |
| `-e SONDE_ADMIN_PASSWORD=...` | Bootstrap admin password. Required to access the dashboard. |
| `-e SONDE_DB_PATH=/data/sonde.db` | SQLite path inside the container. |
| `-v sonde-data:/data` | Persist the SQLite database across restarts. |

See [Hub Configuration](/hub/configuration/) for all environment variables.

## Docker Compose

The repository includes `docker/docker-compose.yml`:

```yaml
services:
  sonde-hub:
    build:
      context: ..
      dockerfile: docker/hub.Dockerfile
    environment:
      SONDE_SECRET: ${SONDE_SECRET:?Set SONDE_SECRET env var}
      SONDE_DB_PATH: /data/sonde.db
      SONDE_ADMIN_USER: admin
      SONDE_ADMIN_PASSWORD: ${SONDE_ADMIN_PASSWORD:?Set SONDE_ADMIN_PASSWORD env var}
    volumes:
      - hub-data:/data
    ports:
      - '3000:3000'
    healthcheck:
      test: ['CMD', 'wget', '--spider', '-q', 'http://localhost:3000/health']
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

volumes:
  hub-data:
```

To use the published image instead of building from source, replace the `build` block:

```yaml
services:
  sonde-hub:
    image: ghcr.io/physikal/hub:latest
    environment:
      SONDE_SECRET: ${SONDE_SECRET:?Set SONDE_SECRET env var}
      SONDE_DB_PATH: /data/sonde.db
      SONDE_ADMIN_USER: admin
      SONDE_ADMIN_PASSWORD: ${SONDE_ADMIN_PASSWORD:?Set SONDE_ADMIN_PASSWORD env var}
    volumes:
      - hub-data:/data
    ports:
      - '3000:3000'
    healthcheck:
      test: ['CMD', 'wget', '--spider', '-q', 'http://localhost:3000/health']
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

volumes:
  hub-data:
```

Start with:

```bash
docker compose up -d
```

## Volumes

The hub stores all persistent state in a single SQLite database. Mount a volume at `/data` to preserve it across container lifecycle events.

| Mount point | Purpose |
|---|---|
| `/data` | SQLite database (`sonde.db`), agent records, audit logs, API keys, setup state. |

Without a volume mount, all data is lost when the container is removed.

## Health check

The hub exposes a health endpoint:

```
GET /health
```

Returns HTTP 200 when the hub is ready. Use this for container orchestration, load balancer checks, and monitoring.

Docker Compose example (already included in the Compose file above):

```yaml
healthcheck:
  test: ['CMD', 'wget', '--spider', '-q', 'http://localhost:3000/health']
  interval: 5s
  timeout: 3s
  retries: 10
  start_period: 10s
```

Alternatively, with `curl`:

```yaml
healthcheck:
  test: ['CMD', 'curl', '-f', 'http://localhost:3000/health']
  interval: 10s
  timeout: 5s
  retries: 3
```

The Alpine-based image includes `wget` but not `curl` by default.

## Building from source

To build the Docker image locally from the repository root:

```bash
docker build -f docker/hub.Dockerfile -t sonde-hub .
```

Then run it:

```bash
docker run -d \
  --name sonde-hub \
  -p 3000:3000 \
  -e SONDE_SECRET=your-secret-key \
  -v sonde-data:/data \
  sonde-hub
```

## Image architecture

The Dockerfile uses a multi-stage build:

1. **Builder stage** (`node:22-alpine`): Installs all dependencies, compiles TypeScript for `@sonde/shared`, `@sonde/packs`, `@sonde/hub`, and builds the `@sonde/dashboard` React SPA.
2. **Runtime stage** (`node:22-alpine`): Installs only production dependencies, copies compiled output from the builder. The dashboard is bundled as static assets served directly by the hub.

This keeps the final image small by excluding dev dependencies, TypeScript source, and build tooling.
