---
title: Hub Configuration
---

All hub configuration is done through environment variables. There are no config files to manage.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SONDE_SECRET` | Yes | — | Encryption root of trust (AES-256-GCM) and fallback auth secret. Must be at least 16 characters. |
| `SONDE_HUB_URL` | No | — | Public URL of the hub (e.g., `https://mcp.example.com`). Required for SSO callback URLs and agent enrollment. Used in install scripts and enrollment token payloads. |
| `SONDE_ADMIN_USER` | Recommended | — | Username for the bootstrap admin login. Required to access the dashboard and configure SSO, integrations, etc. The hub starts without it, but you won't be able to log in. |
| `SONDE_ADMIN_PASSWORD` | Recommended | — | Password for the bootstrap admin login. Choose a strong value. Must be set together with `SONDE_ADMIN_USER`. |
| `PORT` | No | `3000` | HTTP port the hub listens on. |
| `HOST` | No | `0.0.0.0` | Bind address. Set to `127.0.0.1` to restrict to localhost. |
| `SONDE_DB_PATH` | No | `./sonde.db` | Path to the SQLite database file. In Docker, this defaults to `/data/sonde.db`. |
| `SONDE_TLS` | No | `false` | Enable TLS/mTLS for agent WebSocket connections. When enabled, the hub acts as a CA and issues certificates to agents during enrollment. |
| `LOG_LEVEL` | No | `info` | Pino log level. One of: `fatal`, `error`, `warn`, `info`, `debug`, `trace`. |
| `NODE_ENV` | No | — | Set to `production` to disable pretty-printed logs (outputs structured JSON instead). |

:::note
`SONDE_API_KEY` is accepted as a fallback for `SONDE_SECRET` for backward compatibility, but is deprecated. If both are set, `SONDE_SECRET` takes precedence. Migrate to `SONDE_SECRET` — `SONDE_API_KEY` will be removed in a future release.
:::

## Setting variables

**Docker:**

```bash
docker run -d \
  -e SONDE_SECRET=your-secret-key \
  -e SONDE_HUB_URL=https://mcp.example.com \
  -e SONDE_ADMIN_USER=admin \
  -e SONDE_ADMIN_PASSWORD=change-me \
  -e PORT=8080 \
  -p 8080:8080 \
  -v sonde-data:/data \
  ghcr.io/physikal/hub:latest
```

**Docker Compose:**

```yaml
services:
  sonde-hub:
    image: ghcr.io/physikal/hub:latest
    environment:
      SONDE_SECRET: your-secret-key
      SONDE_HUB_URL: https://mcp.example.com
      SONDE_ADMIN_USER: admin
      SONDE_ADMIN_PASSWORD: change-me
      SONDE_DB_PATH: /data/sonde.db
    volumes:
      - hub-data:/data
    ports:
      - '3000:3000'
```

**Bare metal:**

```bash
export SONDE_SECRET=your-secret-key
export SONDE_HUB_URL=https://mcp.example.com
export SONDE_ADMIN_USER=admin
export SONDE_ADMIN_PASSWORD=change-me
export SONDE_DB_PATH=/var/lib/sonde/sonde.db
node packages/hub/dist/index.js
```

Or inline:

```bash
SONDE_SECRET=your-secret-key SONDE_DB_PATH=/var/lib/sonde/sonde.db node packages/hub/dist/index.js
```

## Secret requirements

The hub secret (`SONDE_SECRET`) is the root of trust for all encryption in Sonde. It is used to:

- Derive AES-256-GCM keys for encrypting integration credentials and SSO client secrets.
- Authenticate MCP client requests (as a fallback when no API keys exist yet).

Choose a strong, random value. For example:

```bash
openssl rand -hex 32
```

API keys are managed via the hub dashboard — there is no hardcoded master key. Agents do not use the secret directly. During enrollment, the hub mints a scoped API key for each agent automatically.

## Database

The hub uses SQLite for all persistent state: agents, API keys, audit logs, OAuth clients, sessions, and setup status. The database file is created automatically on first start.

To back up the hub, copy the SQLite file while the hub is stopped, or use SQLite's `.backup` command.

In Docker, mount a volume at `/data` to persist the database across container restarts:

```bash
docker run -v sonde-data:/data ...
```

## TLS / mTLS

When `SONDE_TLS=true`, the hub generates a CA certificate and issues client certificates to agents during enrollment. This provides mutual TLS authentication for agent WebSocket connections.

For most deployments behind a reverse proxy with TLS termination, you can leave this disabled and rely on the proxy for transport encryption.
