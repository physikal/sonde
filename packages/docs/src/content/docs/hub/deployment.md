---
title: Hub Deployment
---

The Sonde hub is the central server that agents connect to. It serves the MCP API, the WebSocket endpoint for agents, and the web dashboard. This guide covers all supported deployment methods.

## Docker (recommended)

The fastest way to run the hub:

```bash
docker run -d --name sonde-hub \
  -p 3000:3000 \
  -e SONDE_SECRET=$(openssl rand -hex 32) \
  -e SONDE_ADMIN_USER=admin \
  -e SONDE_ADMIN_PASSWORD=change-me \
  -v sonde-data:/data \
  ghcr.io/physikal/hub:latest
```

This starts the hub on port 3000 with SQLite data persisted in a named volume. `SONDE_ADMIN_USER` and `SONDE_ADMIN_PASSWORD` are needed to log into the dashboard.

See the [Docker deployment guide](/hub/docker/) for advanced options, Compose files, and building from source.

## Docker Compose

The repository includes a ready-to-use Compose file at `docker/docker-compose.yml`:

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
    restart: unless-stopped
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
export SONDE_SECRET=$(openssl rand -hex 32)
export SONDE_ADMIN_PASSWORD=your-strong-password
docker compose up -d
```

The `hub-data` volume persists the SQLite database across container restarts. Set `SONDE_SECRET` to a strong random value (at least 16 characters — see [Hub Configuration](/hub/configuration/)).

## From source

Clone the repo and build all packages:

```bash
git clone https://github.com/physikal/sonde.git
cd sonde
npm install
npm run build
```

Then start the hub:

```bash
SONDE_SECRET=your-secret-key node packages/hub/dist/index.js
```

The hub will listen on port 3000 by default. Override with the `PORT` environment variable.

## Setup wizard

After starting the hub, open the setup wizard in your browser:

```
http://your-hub:3000
```

The wizard walks through initial configuration: creating an API key, configuring AI tool access, and generating agent enrollment tokens. Setup state is persisted in SQLite and only runs once.

## Port and bind address

The hub listens on port 3000 by default, bound to all interfaces (`0.0.0.0`). Configure with environment variables:

```bash
PORT=8080 HOST=127.0.0.1 SONDE_SECRET=... node packages/hub/dist/index.js
```

See [Hub Configuration](/hub/configuration/) for the full list of environment variables.

## Reverse proxy

The hub works behind any reverse proxy. Proxy HTTP and WebSocket traffic to port 3000.

**Nginx:**

```nginx
server {
    listen 443 ssl;
    server_name mcp.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Caddy:**

```
mcp.example.com {
    reverse_proxy localhost:3000
}
```

Both Nginx and Caddy handle WebSocket upgrades automatically with the above configuration. TLS termination happens at the proxy; the hub receives plain HTTP internally.

## Dokploy

For Dokploy users, deploy directly from GitHub:

1. Create a new application in Dokploy.
2. Point it at the Sonde repository.
3. Set the Dockerfile path to `docker/hub.Dockerfile` (or the root `Dockerfile` if present).
4. Add the required environment variables: `SONDE_SECRET`, `SONDE_HUB_URL` (your public URL), `SONDE_ADMIN_USER`, and `SONDE_ADMIN_PASSWORD`.
5. Deploy.

Dokploy handles builds, restarts, and TLS via its built-in Traefik integration.
