# Deploy Sonde Hub on Dokploy

[Dokploy](https://dokploy.com) is an open-source PaaS with a built-in Traefik reverse proxy and Let's Encrypt TLS. This guide walks through deploying Sonde Hub as a Compose project in Dokploy.

## Prerequisites

- A running Dokploy instance (v0.9+ recommended)
- A domain pointing to your Dokploy server (e.g. `sonde.example.com`)
- DNS A/AAAA record already resolving to the server's IP

## Quick Start

### 1. Create a Compose Project

In the Dokploy dashboard:

1. Click **Projects** → **+ Create Project** → give it a name (e.g. "Sonde")
2. Inside the project, click **+ Create Service** → **Compose**
3. Under **Source**, choose **Git** and set:
   - **Repository URL:** `https://github.com/sonde-dev/sonde.git`
   - **Branch:** `main`
   - **Compose Path:** `docker/docker-compose.dokploy.yml`

### 2. Set Environment Variables

In the service's **Environment** tab, add these variables:

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `SONDE_API_KEY` | Yes | `a1b2c3d4e5...` | Hub API key. Generate with `openssl rand -hex 32` |
| `SONDE_DOMAIN` | Yes | `sonde.example.com` | Your domain (hostname only, no `https://`) |
| `SONDE_HUB_URL` | No | `https://sonde.example.com` | Defaults to `https://${SONDE_DOMAIN}` if omitted |

Generate an API key from your terminal:

```bash
openssl rand -hex 32
```

Save this key securely — you'll need it to enroll agents and it cannot be recovered from the hub.

### 3. Deploy

Click **Deploy**. Dokploy will:

1. Clone the repo and build the Docker image from `docker/hub.Dockerfile`
2. Start the container with your environment variables
3. Traefik will automatically provision a Let's Encrypt TLS certificate for your domain

The first build takes a few minutes (Node.js dependencies + TypeScript compilation). Subsequent deploys use Docker layer caching.

### 4. Verify

Once the deployment is healthy (green status in Dokploy), open your domain:

```
https://sonde.example.com
```

You should see the Sonde setup wizard. Complete it to configure AI tool integration.

## How It Works

The compose file (`docker/docker-compose.dokploy.yml`) uses Traefik labels that integrate with Dokploy's built-in reverse proxy:

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.sonde.rule=Host(`${SONDE_DOMAIN}`)
  - traefik.http.routers.sonde.entrypoints=websecure
  - traefik.http.routers.sonde.tls.certresolver=letsencrypt
  - traefik.http.services.sonde.loadbalancer.server.port=3000
```

- No ports are exposed to the host — Traefik routes traffic to port 3000 inside the container
- TLS is fully automatic via Let's Encrypt HTTP-01 challenge
- Hub data (SQLite database) is persisted in the `hub-data` Docker volume

## Enrolling Agents

Once the hub is running, enroll agents from your target machines:

```bash
sonde enroll --hub https://sonde.example.com --key YOUR_API_KEY --name my-server
sonde start
```

Or use the enrollment command shown in the setup wizard.

## Updating

To update to the latest version:

1. Go to the Compose service in Dokploy
2. Click **Deploy** (Dokploy will pull the latest code and rebuild)

The `hub-data` volume persists across deployments, so your database, API keys, and enrolled agents are preserved.

## Troubleshooting

### Build fails

Check the build logs in Dokploy. Common causes:
- **Out of memory** — the build requires ~1 GB RAM for `npm ci` + TypeScript compilation. Ensure your server has at least 2 GB available.
- **Network issues** — the build pulls npm packages. Ensure outbound internet access from the Docker build context.

### Certificate not provisioning

- Verify the domain's DNS points to the Dokploy server: `dig +short sonde.example.com`
- Check that ports 80 and 443 are open on the server firewall
- Dokploy's Traefik logs may show ACME errors: check in **Settings** → **Traefik** → **Logs**

### Hub unhealthy

The container has a health check that hits `http://localhost:3000/health`. If it fails:

1. Check container logs in Dokploy for startup errors
2. Ensure `SONDE_API_KEY` is set (the container will fail to start without it)
3. Verify the `hub-data` volume has write permissions

### WebSocket connections failing

If agents can't connect, ensure Dokploy's Traefik is configured to allow WebSocket upgrades. This is the default, but custom Traefik middleware may interfere. The hub's WebSocket endpoint is at `/ws`.
