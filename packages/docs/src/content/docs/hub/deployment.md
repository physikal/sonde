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

## Windows (MSI)

The MSI installer deploys the hub as a Windows service. It bundles Node.js, the hub, dashboard, and a WinSW service wrapper. Download the latest `.msi` from the [GitHub releases page](https://github.com/physikal/sonde/releases).

### Installation wizard

The installer walks through these steps:

1. **Welcome** — Standard welcome dialog
2. **Secret Storage** — Choose how the hub stores its encryption secret:
   - **Standalone** — Generates a random 64-character hex key locally. No external dependencies. Good for evaluation and small deployments.
   - **Azure Key Vault** — Fetches the secret from your vault at startup. No encryption key is stored on disk. Recommended for production.
3. **Azure Key Vault Configuration** (only if you chose Key Vault) — Enter:
   - **Key Vault URL** — Full vault URL (e.g., `https://sonde-vault.vault.azure.net`)
   - **Secret Name** — Name of the secret in the vault (default: `sonde-secret`)
   - **Auth Method** — Managed Identity (recommended for Azure VMs) or App Registration (for non-Azure hosts)
   - **Tenant ID, Client ID, Client Secret** — Only required for App Registration auth
4. **Ready to Install** — Review and confirm

See [Azure Key Vault configuration](/hub/configuration/#azure-key-vault) for details on setting up the vault, creating the secret, and configuring authentication.

### What the installer does

- Installs the hub to `C:\Program Files\Sonde Hub\`
- Creates `C:\ProgramData\Sonde\sonde-hub.env` with your configuration
- Registers and starts a Windows service (`SondeHub`) via WinSW
- The service runs as LocalSystem and starts automatically on boot

### Post-install configuration

After installation, edit `C:\ProgramData\Sonde\sonde-hub.env` to set additional variables:

```ini
# Uncomment and edit as needed:
PORT=3000
HOST=0.0.0.0
SONDE_ADMIN_USER=admin
SONDE_ADMIN_PASSWORD=your-password
SONDE_HUB_URL=https://mcp.example.com
```

Restart the service after changes:

```powershell
Restart-Service SondeHub
```

### Maintenance mode

The MSI supports Change, Repair, and Remove operations via **Add/Remove Programs**:

- **Change** — Re-run the configuration wizard (e.g., switch from standalone to Key Vault). The installer backs up the existing `.env` file before regenerating it.
- **Repair** — Reinstall files without changing configuration.
- **Remove** — Uninstall the hub and stop the service.

Previous selections are remembered in the registry (`HKLM\SOFTWARE\Sonde\Hub`) and pre-populated in the dialogs during Change operations. The client secret is the exception — it's never stored in the registry and must be re-entered.

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
