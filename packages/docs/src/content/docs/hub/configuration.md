---
title: Hub Configuration
---

All hub configuration is done through environment variables. There are no config files to manage.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SONDE_API_KEY` | Yes | — | Master API key for authenticating MCP clients and managing the hub. Must be at least 16 characters. |
| `PORT` | No | `3000` | HTTP port the hub listens on. |
| `HOST` | No | `0.0.0.0` | Bind address. Set to `127.0.0.1` to restrict to localhost. |
| `SONDE_DB_PATH` | No | `./sonde.db` | Path to the SQLite database file. In Docker, this defaults to `/data/sonde.db`. |
| `SONDE_TLS` | No | `false` | Enable TLS/mTLS for agent WebSocket connections. When enabled, the hub acts as a CA and issues certificates to agents during enrollment. |
| `SONDE_HUB_URL` | No | — | Public URL of the hub (e.g., `https://mcp.example.com`). Used in install scripts and enrollment token payloads so agents know where to connect. |

## Setting variables

**Docker:**

```bash
docker run -d \
  -e SONDE_API_KEY=your-secret-key \
  -e PORT=8080 \
  -e SONDE_HUB_URL=https://mcp.example.com \
  -p 8080:8080 \
  -v sonde-data:/data \
  ghcr.io/sonde-dev/hub:latest
```

**Docker Compose:**

```yaml
services:
  sonde-hub:
    image: ghcr.io/sonde-dev/hub:latest
    environment:
      SONDE_API_KEY: your-secret-key
      SONDE_DB_PATH: /data/sonde.db
      SONDE_HUB_URL: https://mcp.example.com
    volumes:
      - hub-data:/data
    ports:
      - '3000:3000'
```

**Bare metal:**

```bash
export SONDE_API_KEY=your-secret-key
export SONDE_DB_PATH=/var/lib/sonde/sonde.db
export SONDE_HUB_URL=https://mcp.example.com
node packages/hub/dist/index.js
```

Or inline:

```bash
SONDE_API_KEY=your-secret-key SONDE_DB_PATH=/var/lib/sonde/sonde.db node packages/hub/dist/index.js
```

## API key requirements

The master API key (`SONDE_API_KEY`) is the root credential for the hub. It is used to:

- Authenticate MCP client requests (passed as a Bearer token).
- Access the REST API for agent management.
- Generate enrollment tokens via the dashboard.

Choose a strong, random value. For example:

```bash
openssl rand -hex 32
```

Agents do not use the master API key. During enrollment, the hub mints a scoped API key for each agent automatically.

## Database

The hub uses SQLite for all persistent state: agents, API keys, audit logs, OAuth clients, and setup status. The database file is created automatically on first start.

To back up the hub, copy the SQLite file while the hub is stopped, or use SQLite's `.backup` command.

In Docker, mount a volume at `/data` to persist the database across container restarts:

```bash
docker run -v sonde-data:/data ...
```

## TLS / mTLS

When `SONDE_TLS=true`, the hub generates a CA certificate and issues client certificates to agents during enrollment. This provides mutual TLS authentication for agent WebSocket connections.

For most deployments behind a reverse proxy with TLS termination, you can leave this disabled and rely on the proxy for transport encryption.
