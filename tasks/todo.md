# Phase 5: Hub Installer & Deployment Configs

## Implementation

- [x] Create `scripts/install-hub.sh` (750 lines)
  - [x] Step 1: Header + utilities (colors, pipe detection, generate_key, validate_domain)
  - [x] Step 2: OS/arch/distro/package manager detection
  - [x] Step 3: Prerequisite checks (Docker, Docker Compose, git, port checks)
  - [x] Step 4: Networking mode selection (Traefik / Cloudflare / Local+Tailscale)
  - [x] Step 5: Install directory + git clone (idempotent update on re-run)
  - [x] Step 6: .env generation (preserves existing API key)
  - [x] Step 7: Compose file generation (3 templates: local, traefik, cloudflare)
  - [x] Step 8: Build + launch (docker compose build + up -d)
  - [x] Step 9: Health check wait loop (curl for local/traefik, docker inspect for cloudflare)
  - [x] Step 10: Summary output (URL, API key, enrollment instructions, useful commands)
- [x] shellcheck — zero warnings
- [ ] Functional test — local mode on dev machine (requires Docker)
- [x] Fix macOS grep bug (`grep -oP` → portable `sed -n`)
- [x] Self-signed cert HTTPS option for local mode (`local-tls` with Caddy sidecar)
- [x] Create `docker/docker-compose.dokploy.yml` (Traefik labels for Dokploy)
- [x] Create `docker/docker-compose.cloudflare.yml` (standalone Cloudflare Tunnel)

## Verification

| Check | Status |
|-------|--------|
| `shellcheck scripts/install-hub.sh` | Pass (0 warnings) |
| `npm run build` | Pass (5/5 packages) |
| `npm run test` | Pass (192 tests) |
| `npm run lint` | Pass (133 files, 0 issues) |
| Local mode test | Pending (needs Docker) |
| Idempotency (re-run) | Pending |

## Review

**Installer script** (`scripts/install-hub.sh`): ~800 lines. Three networking modes (local, traefik, cloudflare) plus a local-tls sub-option. macOS grep bug fixed (line 453: `grep -oP` → `sed -n`). Self-signed cert option generates EC P-256 x509 cert via openssl and runs Caddy as a reverse proxy sidecar.

**Dokploy compose** (`docker/docker-compose.dokploy.yml`): Builds from source with Traefik labels for Dokploy's built-in Traefik. Comment header with step-by-step Dokploy UI instructions. Required env vars: `SONDE_API_KEY`, `SONDE_HUB_URL`, `SONDE_DOMAIN`.

**Cloudflare compose** (`docker/docker-compose.cloudflare.yml`): Standalone compose with `cloudflared` sidecar. No exposed ports. Comment header with tunnel setup instructions. Uses `.env` file for config.

**No hub, dashboard, or package source code changes.** Only the installer script and two new Docker Compose files.
