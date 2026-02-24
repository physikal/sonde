# Sonde Deployment & UX

## Hub Deployment Paths

### Path 1: One-Liner Installer (primary)

```bash
curl -fsSL https://sonde.dev/install-hub | sh
```

Interactive TUI handles full dependency chain. Detects what's present, installs what's missing.

**Dependencies:** Docker, Docker Compose — prompts before installing.

**Networking options (presented in TUI):**

**Option A: Public domain + Let's Encrypt**
- User provides domain, installer checks DNS
- Configures Caddy or Traefik with auto LE
- Cloudflare DNS → walks through API token, DNS-01 challenge

**Option B: Cloudflare Tunnel (zero port forwarding)**
- Walks through tunnel creation
- Hub publicly accessible without firewall changes

**Option C: Local / Tailscale only**
- Self-signed or Tailscale HTTPS certs
- Internal use only

Post-config: generates Docker Compose, starts stack, opens setup wizard URL. Offers to install agent on same box.

### Path 2: Dokploy

One-click from GitHub. Docker Compose with Traefik labels:

```yaml
services:
  sonde-hub:
    image: ghcr.io/physikal/hub:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - SONDE_DOMAIN=${SONDE_DOMAIN}
      - SONDE_TLS_MODE=reverse-proxy
      - SONDE_DB_PATH=/data/sonde.db
      - SONDE_ADMIN_EMAIL=${ADMIN_EMAIL}
    volumes:
      - sonde-data:/data
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.sonde.rule=Host(`${SONDE_DOMAIN}`)"
      - "traefik.http.routers.sonde.entrypoints=websecure"
      - "traefik.http.routers.sonde.tls.certresolver=letsencrypt"
volumes:
  sonde-data:
```

### Path 3: Manual Docker Compose (power users)

Add to existing stack, point existing reverse proxy at it.

### Path 4: Cloud Images (v2)

DigitalOcean, AWS, Hetzner marketplace.

## Hub Setup Wizard (Web UI)

1. Create admin account
2. Domain & TLS verification
3. Connect AI tools (MCP URL for Claude.ai, config for Claude Code, API keys)
4. Enroll first agent (generate token, show one-liner, live status)
5. Done → "Ask Claude about your agent"

## Hub Dashboard

- Fleet overview (agents, status, packs, last check-in)
- Agent detail (probes, history, audit, health)
- Enrollment (tokens, live agent appear)
- API key management + policy editor
- Audit log with search/filter
- "Try it" dry-run diagnostic panel
- Real-time updates via WebSocket

## Agent Install TUI

```
┌─────────────────────────────────────────────┐
│          🛰️  Sonde Agent Installer          │
├─────────────────────────────────────────────┤
│  Hub URL:  https://hub.mysonde.dev          │
│  Token:    ●●●●●●●●●●●●                    │
│  ✅ Connecting to hub...                    │
│  ✅ Exchanging certificates...              │
│  🔄 Scanning system for software...         │
├─────────────────────────────────────────────┤
│  Detected Software:                         │
│  ☑ Docker 27.1.1      → docker pack        │
│  ☑ systemd 255        → systemd pack       │
│  ☐ nginx 1.24         → nginx pack         │
│  ↑↓ navigate  space select  enter confirm   │
└─────────────────────────────────────────────┘
```

Permission approval → enrollment → systemd service → connected.

## Agent Management TUI

Running `sonde` launches persistent interactive app:

```
┌─ Sonde Agent: srv-web01-a7f3 ─────── Connected 🟢 ─┐
│  Packs              Status       Last Probe          │
│  ▶ docker           active       12s ago             │
│  ▶ systemd          active       45s ago             │
│  Recent Activity                                     │
│  14:23:01  docker.containers.list  → 12 results      │
│  14:23:00  docker.daemon.info      → ok              │
├──────────────────────────────────────────────────────┤
│ p packs  l logs  s status  a audit  q quit           │
└──────────────────────────────────────────────────────┘
```

## Full UX Journey

```
Hub Install → curl or Dokploy → setup wizard → get MCP URL
Claude Setup → paste MCP URL → OAuth → done
Agent Install → curl → TUI → select packs → approve → connected
Daily Use → talk to Claude → Sonde tools fire automatically
```
