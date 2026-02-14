# Sonde — AI Infrastructure Agent

## Project Vision
A hub-and-spoke MCP-compatible agent system that allows AI assistants (Claude, etc.) to gather information from remote infrastructure for troubleshooting and monitoring. Read-only by default, secure by design, easy to deploy.

**Tagline concept:** *"Launch a Sonde into your infrastructure. Let AI read the data."*

---

## Architecture

### Hub & Spoke Model
- **Sonde Hub** — Central MCP server ("ground station"). Single endpoint that MCP clients (Claude.ai, etc.) connect to.
- **Sondes (Agents)** — Lightweight agents deployed on target machines. Connect **outbound** to the hub via WebSocket (no inbound ports needed, NAT/firewall friendly).
- **Packs** — Capability plugins / "instrument packs" that define what probes an agent can run (Docker, systemd, Postgres, nginx, etc.)
- **Readings** — Probe results returned from agents.
- **Runbooks** — Diagnostic workflows that orchestrate multiple probes for a given problem category.

### Communication Flow
1. Agent initiates outbound WebSocket connection to Hub (persistent, bidirectional)
2. Claude sends MCP tool call to Hub
3. Hub relays structured probe descriptor to agent over existing WebSocket
4. Agent executes mapped read-only command locally
5. Output passes through scrubbing pipeline
6. Result returns to Hub → Hub returns to Claude

### Key Design Principle
Agents NEVER listen on a port. They connect outbound only. If connection drops, agent reconnects with exponential backoff. Hub queues pending requests or times them out.

---

## Security Model

### Principle: Defense in Depth
Every hop authenticates both sides. Every payload is signed. Every operation is logged. The agent never runs as root. No pack gets access without explicit user approval.

### Full Chain Overview
```
Claude.ai
  ↓ HTTPS + OAuth/API key + session token
Sonde Hub
  ↓ Validates MCP auth → checks policy → signs probe request
  ↓ WSS + mTLS + payload signature
Sonde Agent
  ↓ Verifies hub signature → checks pack capability ceiling
  ↓ Executes as unprivileged 'sonde' user with group-based access
Target System (read-only)
  ↑ Result scrubbed → signed → returned over mTLS WSS
Sonde Hub
  ↑ Assembles response → returns via MCP SSE
Claude.ai
```

---

### Layer 1: Agent Installation & System Access

**Dedicated unprivileged user:**
- Installer creates a `sonde` system user and group
- Agent NEVER runs as root — binary drops privileges on startup and refuses to operate as root
- Access is granted via targeted group memberships, not elevated privileges

**Group-based read access per pack:**
- `docker` group → Docker socket access
- `systemd-journal` group → journalctl log access
- `adm` group → `/var/log` syslog file access
- Postgres pack → read-only database role
- Each pack declares required access in its manifest

**Pack permission manifest example:**
```json
{
  "name": "postgres",
  "requires": {
    "groups": [],
    "dbRole": { "type": "postgres", "access": "read-only" },
    "files": ["/var/log/postgresql/*.log"]
  }
}
```

**Approval flow:**
- On `sonde packs install <pack>`, the agent checks if the `sonde` user has the required access
- If not, user is prompted to approve the group addition or access grant
- GUI installer presents this as a checklist: "Docker pack needs docker group access — Approve / Deny"
- No pack ever silently escalates privileges

**Runtime pack expansion:**
- New packs installed later follow the same approval flow
- If access hasn't been granted yet, pack enters a "pending" state
- Agent reports to hub that pack is installed but not yet authorized
- User grants access via GUI or CLI, then pack activates

---

### Layer 2: No Raw Shell Execution
- Agent NEVER receives or executes raw shell commands
- Structured probe descriptors only (e.g., `{ "probe": "docker.containers.list", "params": { "all": true } }`)
- Agent's local executor maps descriptors to actual commands internally
- No code path exists from MCP side to arbitrary execution

---

### Layer 3: Capability Levels & Ceilings
- Each pack handler is tagged with a capability level:
  - **`observe`** — read-only, can never mutate state (DEFAULT)
  - **`interact`** — safe mutations (e.g., restart service)
  - **`manage`** — full control, dangerous operations
- Agent config sets `maxCapability` ceiling (e.g., `observe`)
- Agent cannot load handlers above its ceiling — code path doesn't exist at runtime

---

### Layer 4: Agent ↔ Hub Wire Security (4 sub-layers)

**4a. TLS for transport:**
- All WebSocket connections over WSS (TLS)
- Prevents eavesdropping on the wire
- Standard, baseline, non-negotiable

**4b. Mutual TLS (mTLS) for identity:**
- During enrollment, hub generates a unique client certificate for the agent signed by hub's CA
- Agent stores cert locally (encrypted at rest with hardware-backed key or passphrase)
- On every connection: hub verifies agent's client cert AND agent verifies hub's cert
- MITM cannot impersonate either side

**4c. Single-use enrollment tokens:**
- `sonde enroll --token abc123` — token is valid for ONE use only
- Token expires after 15 minutes
- Token is burned after mTLS cert exchange completes
- No token reuse, no lingering credentials

**4d. Payload signing:**
- Every probe request and response is signed with sender's private key
- Even if TLS layer is somehow compromised, fake probe requests can't be injected
- Agent verifies hub's signature on every inbound request before executing
- Tampered results are detected and rejected

---

### Layer 5: Hub ↔ MCP Client (Claude) Security

**5a. Authentication:**
- OAuth 2.0 flow for hosted SaaS version
- API key auth for self-hosted hubs
- Hub admin interface issues and manages API keys
- Each key is scoped to specific agents and tools

**5b. Session management:**
- After auth, hub issues short-lived session tokens
- Stolen session tokens expire quickly
- Refresh tokens rotate on every use

**5c. Client allowlisting:**
- Hub restricts which MCP client origins are permitted
- Can lock to Claude.ai only, or add custom tools/clients
- Unknown clients cannot complete the handshake

**5d. Per-key policy scoping:**
- Each API key has an attached policy defining:
  - Which agents it can reach
  - Which MCP tools it can call
  - Which capability levels are allowed
- Example: Claude key = observe-only across all agents; CI/CD key = single agent, specific probes only

---

### Layer 6: Output Sanitization
- Scrubbing pipeline on ALL probe output before it leaves the agent
- Strip env vars matching `*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`
- Redact connection strings, `.env` file contents
- Ship sensible default regex set, users can add custom patterns
- Sanitization runs BEFORE payload signing (signed output is always the scrubbed version)

---

### Layer 7: Signed Pack Definitions
- Official packs are code-signed by Sonde build pipeline
- Agent verifies signature before loading any pack
- Community/third-party packs require explicit opt-in for unsigned (`allowUnsignedPacks: true` in agent config)
- Future: community pack review process + counter-signing

---

### Layer 8: Agent Attestation
- On first enrollment, agent fingerprints itself: OS version, binary hash, installed packs, config hash
- Hub stores the attestation record
- On subsequent connections, agent re-attests — if fingerprint changes unexpectedly:
  - Hub flags the anomaly
  - Optionally quarantines the agent until user approves the change
- Prevents supply chain attacks (tampered binary, modified packs outside normal flow)

---

### Layer 9: Audit Trail
- Every probe request and response logged locally on agent AND on hub
- Tamper-evident append-only log (hash chain — each entry includes hash of previous)
- Cryptographic receipt trail for all operations
- Audit log includes: who requested (MCP client/key), what probe ran, which agent, full result, timestamp
- Queryable via hub admin interface or dedicated audit MCP tool

---

## MCP Tool Design (What Claude Sees)

### High-level, intent-driven tools (not raw probe wrappers):

| Tool | Purpose |
|------|---------|
| `list_agents` | Shows online machines and their installed packs |
| `agent_overview` | Quick health snapshot of a specific agent |
| `diagnose` | Takes problem description + target agent, runs relevant battery of probes, returns consolidated report |
| `probe` | Targeted single probe for follow-up info Claude didn't get from diagnose |
| `query_logs` | Search logs across all three access patterns (agent, syslog, external platforms) with unified query interface |

### Diagnostic Workflow Example
User: "My docker isn't working on gmtek01"

1. Claude calls `list_agents` → sees gmtek01 online with Docker + systemd packs
2. Claude calls `diagnose` with `{ agent: "gmtek01", category: "docker", description: "docker not working" }`
3. Hub orchestrates runbook — fires multiple probes in parallel:
   - systemd.service.status → dockerd
   - docker.daemon.info
   - docker.containers.list (all)
   - docker.network.list
   - docker.logs.tail (daemon, last 50 lines)
   - system.disk.usage
   - system.memory.usage
4. Hub assembles structured diagnostic report, returns in ONE MCP tool call
5. Claude reads report, identifies root cause (e.g., disk 98% full), tells user how to fix

6. If needed, Claude uses `probe` for targeted follow-up (e.g., `system.disk.largest_files`)

---

## Pack System

### Concept
- Each software integration is a "pack" — a plugin the agent loads
- Packs declare what probes they support and at what capability level
- Packs are discoverable — agent can scan system and suggest relevant packs

### Example Packs
- **Docker** — containers.list, logs.tail, images.list, networks.list, daemon.info
- **systemd** — services.list, service.status, journal.query
- **Postgres** — databases.list, connections.active, query.explain
- **nginx** — config.test, access.log.tail, error.log.tail
- **System** — disk.usage, memory.usage, cpu.usage, largest_files, network.interfaces
- **Splunk** — query via SPL, search indexes, list alerts (hub-side or agent-side)
- **Elasticsearch** — query indices, search logs, cluster.health
- **Loki** — query via LogQL, label discovery, stream tailing
- **Datadog** — query logs, list monitors, host metrics

### Pack Lifecycle
- Install: `sonde packs install docker`
- List: `sonde packs list`
- Remove: `sonde packs uninstall docker`
- Auto-discover: System scan suggests packs based on installed software

---

## Log Access Patterns

Sonde supports three complementary ways to access logs, all surfaced through the same MCP tools to Claude. Claude doesn't care where logs came from — it just gets readings back.

### Pattern 1: Agent Probes (direct on-box)
- Tail logs directly on the machine via agent packs (`docker.logs.tail`, `journalctl` queries, file-based log tailing)
- Best for: servers and containers where the agent is installed

### Pattern 2: Syslog Ingestion (hub-side)
- Hub runs a syslog listener (UDP 514, TCP 514, TLS 6514) to capture logs from devices that can't run an agent
- Use cases: network switches, firewalls (e.g., Firewalla), IoT devices, appliances, embedded systems
- Logs are ingested into a searchable store on the hub (SQLite with rotation, or embedded Loki)
- A `syslog` pack type registers read-only query probes against ingested logs
- Does NOT break the security model — passive ingestion, no remote execution
- Scoped as a **v2 feature** unless prioritized earlier

### Pattern 3: External Platform Packs (query existing log stacks)
- For environments that already have a logging stack, don't duplicate data — query it in place
- Packs translate Claude's requests into platform-native queries:
  - **Splunk pack** → SPL queries
  - **Elasticsearch pack** → ES DSL queries
  - **Loki pack** → LogQL queries
  - **Datadog pack** → Datadog log query API
- Can be agent-side (query from the box) or hub-side (query centralized APIs directly)
- Best for: enterprises and homelabs with existing observability infrastructure

### Example Flow
User: "My network has been acting weird the last hour"
1. Claude queries syslog ingestion for firewall/switch logs (Pattern 2)
2. Claude probes the relevant servers via agents for interface errors, dropped packets (Pattern 1)
3. Claude queries Loki/Grafana for correlated application logs (Pattern 3)
4. Claude synthesizes findings: "Your switch is flooding ARP requests — here's what's happening and why"

---

## Tech Stack (Locked Decisions)

- **Language:** TypeScript (Node.js 22 LTS) for everything
- **Runtime:** Node.js (hub + agent both run on Node)
- **Monorepo tooling:** npm workspaces + Turborepo for build orchestration
- **Hub HTTP framework:** Hono (lightweight, fast, SSE support built-in, runs anywhere)
- **Hub WebSocket:** ws library (battle-tested, no framework overhead)
- **Hub database:** SQLite via better-sqlite3 (default, zero-config) — Postgres adapter available for large deployments
- **Hub dashboard frontend:** React 19 + Vite + Tailwind CSS (static build, served by Hono)
- **MCP SDK:** @modelcontextprotocol/sdk (official TypeScript SDK)
- **Agent TUI:** Ink v5 (React for terminals — leverages React knowledge)
- **Agent process manager:** runs as systemd service (Linux), launchd (macOS future), Windows Service (future)
- **mTLS / crypto:** node:crypto + node-forge for cert generation
- **Schema validation:** Zod (runtime validation for all protocol messages, pack manifests, configs)
- **Logging:** pino (structured JSON logging, fast)
- **Testing:** Vitest (unit + integration) + Playwright (dashboard e2e)
- **Linting:** Biome (lint + format, single tool, fast)
- **Docker base image:** node:22-alpine
- **Container registry:** GitHub Container Registry (ghcr.io)
- **CI/CD:** GitHub Actions

### Monorepo Packages
- `@sonde/hub` — MCP server, WebSocket server, runbook engine, policy engine, syslog ingestion (v2)
- `@sonde/agent` — WebSocket client, pack loader, probe executor, output scrubber, TUI, CLI
- `@sonde/packs` — Official pack definitions (each pack is a subpackage)
- `@sonde/shared` — Protocol types, Zod schemas, mTLS utils, descriptor schemas
- `@sonde/dashboard` — React frontend for hub (builds to static assets copied into hub image)

---

## CLI Design

```bash
# Install agent
curl -fsSL https://sonde.dev/install | sh

# Enroll with hub
sonde enroll --hub https://hub.sonde.dev --token abc123

# Status
sonde status

# Pack management
sonde packs list
sonde packs install docker
sonde packs uninstall nginx
sonde packs scan  # auto-detect installed software, suggest packs
```

---

## Deployment Options

### Hub Deployment

The hub Docker image is a single container running: Hono HTTP server (MCP SSE + REST API + web dashboard), WebSocket server for agents, and optionally syslog listener. Web dashboard is pre-built static assets served from the same process — no separate frontend container. Node.js Alpine base image for minimal attack surface.

**Default database:** SQLite (zero config, single file, easy backup). Postgres available for larger deployments.

**First boot behavior:** If no database exists, hub enters setup mode automatically. Setup wizard creates database, admin account, generates hub's CA for mTLS, and produces the MCP endpoint URL.

#### Path 1: One-Liner Installer (bare metal / VPS) — Primary Path

```bash
curl -fsSL https://sonde.dev/install-hub | sh
```

Launches an interactive TUI installer that handles full dependency chain. Detects what's already present, only installs what's missing.

**Dependency handling:**
- Detects OS, architecture, existing Docker, available ports, existing reverse proxies
- If Docker not installed → prompts to install via official Docker install script
- If Docker Compose missing → installs it
- Confirms each dependency before acting

**Domain & TLS configuration (three options presented in TUI):**

**Option A: Public domain + Let's Encrypt**
- User provides domain, installer checks DNS resolution
- Configures Caddy or Traefik as reverse proxy with auto Let's Encrypt
- If Cloudflare DNS → walks through API token creation, configures DNS-01 challenge for wildcard certs (solves port 80/443 conflicts)

**Option B: Cloudflare Tunnel (zero port forwarding)**
- Best for homelabbers behind CGNAT or users who don't want exposed ports
- Installer walks through Cloudflare Tunnel creation
- Generates tunnel config, creates DNS entry
- Hub is publicly accessible without opening any firewall ports

**Option C: Local / Tailscale only**
- No public access, hub reachable on LAN or via Tailscale
- Self-signed certs or Tailscale's built-in HTTPS cert provisioning
- Great for testing or purely internal use

**Post-configuration:**
- Installer generates tailored Docker Compose file based on choices
- Spins up the stack, runs health check
- Opens setup wizard URL in browser
- Offers to install an agent on the same box ("Most people want to monitor the hub machine too")

#### Path 2: Dokploy (one-click from GitHub)

User adds a Compose application in Dokploy, points to Sonde repo. Dokploy handles build, deploy, Traefik, TLS, and routing. User fills in domain and email in Dokploy's env var UI and deploys.

```yaml
services:
  sonde-hub:
    image: ghcr.io/sonde-dev/hub:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - SONDE_DOMAIN=${SONDE_DOMAIN}
      - SONDE_TLS_MODE=reverse-proxy  # let Dokploy/Traefik handle TLS
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

Future: "Deploy to Dokploy" button on Sonde website that pre-fills the template.

#### Path 3: Docker Compose (manual, power users)

For users with existing Docker Compose stacks and reverse proxies. Add the Sonde service to existing compose file, point existing Traefik/Caddy/nginx at it. Docs provide config snippets for each common reverse proxy.

#### Path 4: Pre-built Cloud Images (v2)

DigitalOcean marketplace droplet, AWS AMI, Hetzner app — pre-configured VM where everything is already installed. User launches, hits IP in browser, setup wizard. Lowest friction for cloud users.

### Hub Setup Wizard (Web UI, first boot)

```
Step 1: Admin Account
  → Create your login

Step 2: Domain & TLS
  → Confirm/adjust hub URL (auto-detected from installer or manual)
  → Verify TLS is working

Step 3: Connect Your AI
  → "Which AI tools do you use?"
    ☑ Claude.ai      → Here's your MCP URL, paste it in settings
    ☑ Claude Code     → Run this command to configure
    ☐ Cursor          → Here's your MCP config snippet
    ☐ Custom / API    → Here's your API key and endpoint
  → Test connection button (verifies round-trip works)

Step 4: Enroll Your First Agent
  → Generates enrollment token
  → Shows one-liner install command
  → Live status: "Waiting for agent..." → "✅ Agent connected!"

Step 5: Done
  → "Ask Claude: 'What's the status of [agent name]?'"
```

### Hub Web Dashboard (ongoing management)

Clean web UI served from the hub process — the control plane for everything:
- **Fleet view** — all agents, status (online/offline/degraded), installed packs, last check-in
- **Agent detail** — click into any agent: packs, recent probe history, audit log, health metrics
- **Remote pack management** — push pack installs to agents from dashboard (no SSH needed)
- **Enrollment** — generate tokens, see agents appear in real-time as they enroll
- **API key management** — create, scope, revoke keys
- **Policy configuration** — per-key and per-agent policies
- **Client allowlisting** — manage which MCP clients can connect
- **Audit log viewer** — searchable history of all probe requests and results
- **"Try it" panel** — built-in dry-run interface: type a natural language query, see what probes would fire and simulated results. Great for testing runbooks without Claude connected.

Tech: React/Vite/Tailwind served as static assets from Hono. Real-time agent status via WebSocket to browser.

### Agent Deployment

- **One-liner installer** → interactive TUI (see UX Design section)
- **GUI installer** → OpenCode-style (v2, see Future Features)
- **Hub-initiated local install** → at end of hub setup, offer to install agent on same box with auto-enrollment (no token copy-paste needed)

### Auto-Update Strategy

- **Hub:** Watchtower pattern for Docker — checks for new image versions, notifies admin via dashboard. Dokploy users get auto-deploy from GitHub.
- **Agent:** Hub checks agent version compatibility on connection, warns if agents are outdated after hub upgrade. Agent can self-update via `sonde update` command.

---

## MCP & Client Connectivity

### Hub Interfaces (four from one process)

| Interface | Endpoint | Purpose |
|-----------|----------|---------|
| MCP SSE | `/mcp/sse` | For Claude.ai and MCP-native clients |
| REST API | `/api/v1/*` | For custom integrations, bots, OpenClaw |
| WebSocket | `/ws/agent` | For agent connections |
| Web Dashboard | `/dashboard` | For human management |

All four share the same auth layer, policy engine, and audit system.

### Tier 1: Claude.ai (web/mobile) — Remote MCP via SSE

Primary use case. Hub exposes SSE endpoint: `https://hub.yourdomain.com/mcp/sse`

**Auth flow:** OAuth 2.0 authorization code with PKCE. When user adds the connector in Claude.ai, they're redirected to hub's auth page, log in, grant access. OAuth token is issued and stored by Claude.ai. Same flow as Notion/n8n connectors today.

Hub's OAuth server allowlists Claude.ai's client ID by default.

### Tier 2: Claude Code / CLI tools — stdio MCP bridge

Claude Code uses stdio transport (launches local process, communicates via stdin/stdout). Sonde ships a thin bridge command:

```bash
# In Claude Code's MCP config (~/.claude/mcp.json):
{
  "sonde": {
    "command": "sonde",
    "args": ["mcp-bridge", "--hub", "https://hub.yourdomain.com"]
  }
}
```

`sonde mcp-bridge` authenticates to hub using stored API key, translates between stdio MCP locally and HTTPS to hub. Ships as part of `@sonde/agent` or as lightweight `@sonde/cli` package.

### Tier 3: Other AI Platforms (Cursor, OpenAI, Gemini, etc.)

- If they support remote SSE MCP → same endpoint as Claude.ai, just works
- If they use different transport → adapter bridges (like the stdio one)
- Growing MCP adoption makes this increasingly universal

### Tier 4: Direct REST API (custom integrations)

```
POST /api/v1/diagnose
POST /api/v1/probe
GET  /api/v1/agents
GET  /api/v1/agents/:id/overview
POST /api/v1/logs/query
```

Same auth (API keys), same policies, same audit logging. Enables: Slack bots, Telegram integrations, OpenClaw skills, custom dashboards, CI/CD pipelines — anything that can make HTTP requests.

---

## UX Design

### Agent Installer TUI (Ink / React for terminals)

```
┌─────────────────────────────────────────────┐
│          🛰️  Sonde Agent Installer          │
│                  v1.0.0                      │
├─────────────────────────────────────────────┤
│                                             │
│  Hub URL:  https://hub.mysonde.dev          │
│  Token:    ●●●●●●●●●●●●                    │
│                                             │
│  ✅ Connecting to hub...                    │
│  ✅ Verifying token...                      │
│  ✅ Exchanging certificates...              │
│  ✅ Creating sonde system user...           │
│  🔄 Scanning system for software...         │
│                                             │
├─────────────────────────────────────────────┤
│  Detected Software:                         │
│                                             │
│  ☑ Docker 27.1.1      → docker pack        │
│  ☑ systemd 255        → systemd pack       │
│  ☑ PostgreSQL 16      → postgres pack      │
│  ☐ nginx 1.24         → nginx pack         │
│  ☐ Redis 7.2          → redis pack         │
│                                             │
│  ↑↓ navigate  space select  enter confirm   │
├─────────────────────────────────────────────┤
│  [ Continue ]                               │
└─────────────────────────────────────────────┘
```

**Permission approval screen:**
```
┌─────────────────────────────────────────────┐
│  Permissions Required:                      │
│                                             │
│  docker pack:                               │
│    ● Add sonde to 'docker' group            │
│                                             │
│  systemd pack:                              │
│    ● Add sonde to 'systemd-journal' group   │
│                                             │
│  postgres pack:                             │
│    ● Create read-only 'sonde' db role       │
│    ● Grant SELECT on pg_stat_activity       │
│                                             │
│  ⚠ sudo required for group changes          │
│                                             │
│  [ Approve All ]  [ Review Each ]  [ Skip ] │
└─────────────────────────────────────────────┘
```

**Completion screen:**
```
┌─────────────────────────────────────────────┐
│  ✅ Agent enrolled successfully!            │
│                                             │
│  Agent ID:    gmtek01-a7f3                  │
│  Hub:         hub.mysonde.dev               │
│  Status:      Connected                     │
│  Packs:       docker, systemd, postgres     │
│                                             │
│  The agent is running as a systemd service. │
│  Run 'sonde status' anytime to check.       │
│                                             │
│  💡 Ask Claude: "What's running on gmtek01?"│
└─────────────────────────────────────────────┘
```

### Agent Management TUI (persistent app, like k9s/lazydocker)

Running `sonde` in the terminal launches an interactive terminal application:

```
┌─ Sonde Agent: gmtek01-a7f3 ──────── Connected 🟢 ─┐
│                                                      │
│  Packs              Status       Last Probe          │
│  ─────────────────────────────────────────────       │
│  ▶ docker           active       12s ago             │
│  ▶ systemd          active       45s ago             │
│  ▶ postgres         pending ⚠    —                   │
│                                                      │
│  Recent Activity                                     │
│  ─────────────────────────────────────────────       │
│  14:23:01  docker.containers.list  → 12 results      │
│  14:23:01  system.disk.usage       → ok              │
│  14:23:00  docker.daemon.info      → ok              │
│  14:22:59  systemd.service.status  → dockerd active  │
│  14:22:58  diagnose(docker)        → initiated       │
│                                                      │
├──────────────────────────────────────────────────────┤
│ p packs  l logs  s status  a audit  q quit           │
└──────────────────────────────────────────────────────┘
```

**Pack manager screen (press `p`):**
```
┌─ Pack Manager ───────────────────────────────────────┐
│                                                      │
│  Installed                                           │
│  ● docker     v1.2.0   active    [uninstall]         │
│  ● systemd    v1.1.0   active    [uninstall]         │
│  ● postgres   v1.0.0   pending   [grant access]      │
│                                                      │
│  Available (detected on system)                      │
│  ○ nginx      v1.0.0             [install]           │
│  ○ redis      v1.1.0             [install]           │
│                                                      │
│  Available (not detected)                            │
│  ○ mongodb    v1.0.0             [install]           │
│  ○ mysql      v1.0.0             [install]           │
│  ○ loki       v1.0.0             [install]           │
│                                                      │
│ ↑↓ navigate  enter select  / search  esc back        │
└──────────────────────────────────────────────────────┘
```

### TUI Tech Stack

- **Node.js/TypeScript path:** Ink (React for terminals) — leverages existing React knowledge
- **Compiled binary path (alternative):** Bubble Tea (Go) — better for single-binary distribution, used by lazydocker, k9s, etc.

### Full UX Journey Map

```
Hub Install (one-time):
  curl one-liner OR Dokploy deploy
  → TUI installer handles deps, Docker, networking, TLS
  → Visit web UI → setup wizard → get MCP URL
  → Optional: install agent on hub machine too

Claude Setup (one-time):
  paste MCP URL into Claude.ai connector settings
  → OAuth flow → authorize → done
  (or for Claude Code: one config line)

Agent Install (per machine):
  curl one-liner → interactive TUI installer
  → select packs → approve permissions → connected
  → hub dashboard shows new agent in real-time

Daily Use:
  Talk to Claude naturally → Claude uses Sonde tools automatically
  Run 'sonde' on any agent box → see live activity, manage packs
  Visit hub dashboard → fleet overview, policies, audit logs, enrollment
```

---

## Future Features / Ideas

### GUI Installer & Pack Manager
- OpenCode-style GUI installer for the agent
- Visual pack management — scan system, detect software, one-click pack install/uninstall
- Agent management dashboard

### OpenClaw Integration
- OpenClaw skills that trigger Sonde diagnostics
- Sonde probes feeding system context into OpenClaw workflows
- Cross-project integration between recruiting automation and infrastructure management

### Other Considerations
- Windows agent support (PowerShell execution layer)
- Rate limiting on hub
- Output size caps (prevent tailing huge logs through hub)
- Agent offline handling (queue + timeout)
- Community pack marketplace
- Custom runbook definitions
- Claude-suggested runbook improvements over time

---

## Branding

- **Name:** Sonde
- **Domain targets:** sonde.dev (primary), getsonde.dev, usesonde.com (fallbacks)
- **npm org:** @sonde
- **GitHub:** sonde-dev/sonde
- **Metaphor:** A radiosonde — a small instrument package sent into an environment to gather data and transmit it back to a ground station

---

## Project Structure

```
sonde/
├── package.json                    # Root workspace config
├── turbo.json                      # Turborepo build pipeline
├── tsconfig.base.json              # Shared TS config
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                  # Lint, type-check, test on PR
│   │   ├── release.yml             # Build + publish on tag
│   │   └── nightly.yml             # Nightly builds from main
│   └── CODEOWNERS
├── docker/
│   ├── hub.Dockerfile              # Hub production image
│   ├── agent.Dockerfile            # Agent image (for containerized deploys)
│   └── docker-compose.yml          # Reference compose file
├── scripts/
│   ├── install-hub.sh              # Hub one-liner installer script
│   ├── install-agent.sh            # Agent one-liner installer script
│   └── dev.sh                      # Local dev environment bootstrap
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── schemas/
│   │   │   │   ├── protocol.ts     # WebSocket message envelope schemas (Zod)
│   │   │   │   ├── probes.ts       # Probe descriptor schemas
│   │   │   │   ├── packs.ts        # Pack manifest schemas
│   │   │   │   └── mcp.ts          # MCP tool input/output schemas
│   │   │   ├── types/
│   │   │   │   ├── agent.ts        # Agent types
│   │   │   │   ├── hub.ts          # Hub types
│   │   │   │   └── common.ts       # Shared enums, constants
│   │   │   └── crypto/
│   │   │       ├── certs.ts        # mTLS cert generation/validation
│   │   │       ├── signing.ts      # Payload signing/verification
│   │   │       └── tokens.ts       # Enrollment token generation
│   │   └── tsconfig.json
│   ├── hub/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts            # Entry point — starts all servers
│   │   │   ├── mcp/
│   │   │   │   ├── server.ts       # MCP SSE server (using @modelcontextprotocol/sdk)
│   │   │   │   ├── tools/
│   │   │   │   │   ├── diagnose.ts
│   │   │   │   │   ├── probe.ts
│   │   │   │   │   ├── list-agents.ts
│   │   │   │   │   ├── agent-overview.ts
│   │   │   │   │   └── query-logs.ts
│   │   │   │   └── auth.ts         # OAuth + API key validation
│   │   │   ├── ws/
│   │   │   │   ├── server.ts       # WebSocket server for agents
│   │   │   │   ├── connection.ts   # Per-agent connection handler
│   │   │   │   └── dispatcher.ts   # Route probe requests to agents
│   │   │   ├── api/
│   │   │   │   ├── router.ts       # REST API routes (Hono)
│   │   │   │   ├── agents.ts
│   │   │   │   ├── probes.ts
│   │   │   │   ├── keys.ts         # API key management
│   │   │   │   └── audit.ts
│   │   │   ├── engine/
│   │   │   │   ├── runbooks.ts     # Runbook loader + executor
│   │   │   │   ├── policy.ts       # Policy evaluation engine
│   │   │   │   └── scrubber.ts     # Output sanitization (hub-side)
│   │   │   ├── db/
│   │   │   │   ├── index.ts        # Database abstraction
│   │   │   │   ├── sqlite.ts       # SQLite adapter (better-sqlite3)
│   │   │   │   ├── migrations/     # Schema migrations
│   │   │   │   └── models/         # Agent, Key, AuditLog, Policy models
│   │   │   └── config.ts           # Hub configuration (env vars + config file)
│   │   └── tsconfig.json
│   ├── dashboard/
│   │   ├── package.json
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── pages/
│   │   │   │   ├── Fleet.tsx       # Agent fleet overview
│   │   │   │   ├── AgentDetail.tsx  # Single agent view
│   │   │   │   ├── Enrollment.tsx   # Token generation + live enrollment
│   │   │   │   ├── Policies.tsx     # Policy management
│   │   │   │   ├── ApiKeys.tsx      # Key management
│   │   │   │   ├── Audit.tsx        # Audit log viewer
│   │   │   │   ├── Setup.tsx        # First-boot setup wizard
│   │   │   │   └── TryIt.tsx        # Dry-run diagnostic panel
│   │   │   ├── components/
│   │   │   └── hooks/
│   │   │       └── useWebSocket.ts  # Real-time agent status
│   │   └── tsconfig.json
│   ├── agent/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts            # Entry point — CLI router
│   │   │   ├── cli/
│   │   │   │   ├── commands/
│   │   │   │   │   ├── enroll.ts
│   │   │   │   │   ├── status.ts
│   │   │   │   │   ├── packs.ts    # install/uninstall/list/scan
│   │   │   │   │   ├── update.ts
│   │   │   │   │   └── mcp-bridge.ts  # stdio MCP bridge for Claude Code
│   │   │   │   └── router.ts       # CLI command routing
│   │   │   ├── tui/
│   │   │   │   ├── App.tsx         # Ink root component
│   │   │   │   ├── installer/
│   │   │   │   │   ├── InstallerApp.tsx
│   │   │   │   │   ├── StepScan.tsx
│   │   │   │   │   ├── StepPacks.tsx
│   │   │   │   │   ├── StepPermissions.tsx
│   │   │   │   │   └── StepComplete.tsx
│   │   │   │   └── manager/
│   │   │   │       ├── ManagerApp.tsx   # Main management TUI
│   │   │   │       ├── PackManager.tsx
│   │   │   │       ├── ActivityLog.tsx
│   │   │   │       └── AuditView.tsx
│   │   │   ├── runtime/
│   │   │   │   ├── connection.ts    # WebSocket client to hub
│   │   │   │   ├── executor.ts      # Probe execution engine
│   │   │   │   ├── pack-loader.ts   # Load + validate packs
│   │   │   │   ├── scrubber.ts      # Output sanitization
│   │   │   │   └── attestation.ts   # Self-fingerprinting
│   │   │   ├── system/
│   │   │   │   ├── user.ts          # sonde user creation/checks
│   │   │   │   ├── groups.ts        # Group membership management
│   │   │   │   └── scanner.ts       # Detect installed software
│   │   │   └── config.ts            # Agent config (file + env)
│   │   └── tsconfig.json
│   └── packs/
│       ├── package.json
│       ├── src/
│       │   ├── index.ts             # Pack registry
│       │   ├── types.ts             # Pack interface definition
│       │   ├── system/
│       │   │   ├── manifest.json
│       │   │   ├── probes/
│       │   │   │   ├── disk-usage.ts
│       │   │   │   ├── memory-usage.ts
│       │   │   │   ├── cpu-usage.ts
│       │   │   │   ├── largest-files.ts
│       │   │   │   └── network-interfaces.ts
│       │   │   └── runbook.ts       # Default system diagnostic runbook
│       │   ├── docker/
│       │   │   ├── manifest.json
│       │   │   ├── probes/
│       │   │   │   ├── containers-list.ts
│       │   │   │   ├── logs-tail.ts
│       │   │   │   ├── images-list.ts
│       │   │   │   ├── networks-list.ts
│       │   │   │   └── daemon-info.ts
│       │   │   └── runbook.ts       # Default docker diagnostic runbook
│       │   └── systemd/
│       │       ├── manifest.json
│       │       ├── probes/
│       │       │   ├── services-list.ts
│       │       │   ├── service-status.ts
│       │       │   └── journal-query.ts
│       │       └── runbook.ts
│       └── tsconfig.json
```

---

## Protocol Schemas

### WebSocket Message Envelope

All agent ↔ hub communication uses this envelope:

```typescript
// @sonde/shared/src/schemas/protocol.ts

const MessageEnvelope = z.object({
  id: z.string().uuid(),                    // Unique message ID
  type: z.enum([
    'probe.request',                         // Hub → Agent: run a probe
    'probe.response',                        // Agent → Hub: probe result
    'probe.error',                           // Agent → Hub: probe failed
    'agent.register',                        // Agent → Hub: initial registration
    'agent.heartbeat',                       // Agent → Hub: I'm alive + capabilities
    'hub.ack',                               // Hub → Agent: registration accepted
    'hub.reject',                            // Hub → Agent: registration rejected
  ]),
  timestamp: z.string().datetime(),          // ISO 8601
  agentId: z.string().optional(),            // Set after registration
  signature: z.string(),                     // Payload signature (base64)
  payload: z.unknown(),                      // Type-specific payload (validated per type)
});
```

### Probe Request (Hub → Agent)

```typescript
const ProbeRequest = z.object({
  probe: z.string(),                         // e.g., "docker.containers.list"
  params: z.record(z.unknown()).optional(),   // Probe-specific parameters
  timeout: z.number().default(30000),        // ms, max time for probe execution
  requestedBy: z.string(),                   // API key ID or OAuth client ID
  runbookId: z.string().optional(),          // If part of a runbook execution
});
```

### Probe Response (Agent → Hub)

```typescript
const ProbeResponse = z.object({
  probe: z.string(),                         // Echo back which probe ran
  status: z.enum(['success', 'error', 'timeout', 'unauthorized']),
  data: z.unknown(),                         // Probe-specific result (already scrubbed)
  durationMs: z.number(),                    // How long execution took
  metadata: z.object({
    agentVersion: z.string(),
    packName: z.string(),
    packVersion: z.string(),
    capabilityLevel: z.enum(['observe', 'interact', 'manage']),
  }),
});
```

### Pack Manifest

```typescript
const PackManifest = z.object({
  name: z.string(),                          // e.g., "docker"
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string(),
  author: z.string().optional(),
  signature: z.string().optional(),          // Code signature (base64)

  requires: z.object({
    groups: z.array(z.string()).default([]),  // OS groups needed
    files: z.array(z.string()).default([]),   // File paths needed (glob OK)
    commands: z.array(z.string()).default([]),// Binaries that must exist in PATH
    dbRole: z.object({                       // Database access if needed
      type: z.enum(['postgres', 'mysql', 'mongodb']),
      access: z.enum(['read-only', 'read-write']),
    }).optional(),
  }),

  probes: z.array(z.object({
    name: z.string(),                        // e.g., "containers.list"
    description: z.string(),
    capability: z.enum(['observe', 'interact', 'manage']),
    params: z.record(z.object({              // Parameter definitions
      type: z.enum(['string', 'number', 'boolean']),
      description: z.string(),
      required: z.boolean().default(false),
      default: z.unknown().optional(),
    })).optional(),
    timeout: z.number().default(30000),
  })),

  runbook: z.object({
    category: z.string(),                    // e.g., "docker"
    probes: z.array(z.string()),             // Ordered list of probes to run
    parallel: z.boolean().default(true),     // Run probes in parallel?
  }).optional(),

  detect: z.object({                         // How to auto-detect this software
    commands: z.array(z.string()).optional(), // Check if these exist (e.g., ["docker"])
    files: z.array(z.string()).optional(),    // Check if these files exist
    services: z.array(z.string()).optional(), // Check if these systemd services exist
  }).optional(),
});
```

### MCP Tool Schemas (What Claude Sees)

```typescript
// diagnose tool input
const DiagnoseInput = z.object({
  agent: z.string(),                         // Agent name or ID
  category: z.string(),                      // Pack category (e.g., "docker", "system")
  description: z.string().optional(),        // Natural language problem description
});

// diagnose tool output
const DiagnoseOutput = z.object({
  agent: z.string(),
  timestamp: z.string().datetime(),
  category: z.string(),
  runbookId: z.string(),
  findings: z.record(z.unknown()),           // Keyed by probe name → result
  summary: z.object({
    probesRun: z.number(),
    probesSucceeded: z.number(),
    probesFailed: z.number(),
    durationMs: z.number(),
  }),
});

// probe tool input
const ProbeInput = z.object({
  agent: z.string(),
  probe: z.string(),                         // Full probe name: "docker.containers.list"
  params: z.record(z.unknown()).optional(),
});

// list_agents tool output
const ListAgentsOutput = z.object({
  agents: z.array(z.object({
    id: z.string(),
    name: z.string(),
    status: z.enum(['online', 'offline', 'degraded']),
    lastSeen: z.string().datetime(),
    packs: z.array(z.object({
      name: z.string(),
      version: z.string(),
      status: z.enum(['active', 'pending', 'error']),
    })),
    os: z.string(),
    agentVersion: z.string(),
  })),
});
```

---

## MVP Definition (Phase 0)

**Goal:** Prove the end-to-end concept. Claude asks a question about a server, gets an answer back through Sonde, zero copy-paste.

**MVP scope — nothing more:**

- Hub: Hono HTTP server with MCP SSE endpoint + WebSocket server for agents
- Hub auth: API key only (single hardcoded key in env var — no OAuth, no dashboard yet)
- Agent: WebSocket client that connects to hub + system pack only
- One MCP tool: `probe` (direct probe execution, no `diagnose` or runbooks yet)
- One pack: `system` with 3 probes: `system.disk.usage`, `system.memory.usage`, `system.cpu.usage`
- No mTLS (plain WSS with API key header for MVP)
- No TUI (CLI-only: `sonde enroll`, `sonde status`)
- No output scrubbing (MVP only returns safe system metrics)
- No pack manifest validation or signing
- No dashboard
- SQLite database for agent registry + basic audit log

**MVP demonstrates:**
1. Install hub (docker-compose up)
2. Install agent (npm install -g, then `sonde enroll --hub <url> --key <key>`)
3. Add MCP connector URL to Claude.ai
4. Say "What's the disk usage on my server?"
5. Claude calls `probe` tool → hub routes to agent → agent runs `df` → result comes back → Claude answers

**MVP is NOT production. It's a proof of concept that validates the architecture.**

---

## Phased Build Plan

### Phase 0: MVP (Week 1-2)
See MVP Definition above. End-to-end proof of concept.

**Deliverables:**
- `@sonde/shared`: Base protocol Zod schemas (message envelope, probe request/response)
- `@sonde/hub`: Hono server, MCP SSE with `probe` tool, WebSocket server, SQLite, API key auth
- `@sonde/agent`: WebSocket client, CLI (enroll + status), system probe executor
- `@sonde/packs`: System pack (disk, memory, CPU)
- `docker-compose.yml` for local hub
- README with setup instructions

### Phase 1: Core Pack System (Week 3-4)
Build the pack infrastructure that makes Sonde actually useful.

**Deliverables:**
- Pack manifest schema + validation
- Pack loader on agent (load from filesystem)
- Docker pack (containers.list, logs.tail, images.list, daemon.info)
- systemd pack (services.list, service.status, journal.query)
- `diagnose` MCP tool + runbook engine on hub
- `list_agents` and `agent_overview` MCP tools
- Agent software scanner (detect installed software, suggest packs)
- `sonde packs install/uninstall/list/scan` CLI commands
- Pack permission manifest + approval flow (CLI-based: prompt user for sudo)

### Phase 2: Auth Hardening (Week 5-6)
Make it production-secure.

**Deliverables:**
- mTLS implementation: hub CA, cert generation during enrollment, mutual verification
- Single-use, time-limited enrollment tokens (generated on hub, burned after use)
- Payload signing on all messages
- Output sanitization pipeline (scrubber with default regex + custom patterns)
- Agent attestation (fingerprint on enrollment, verify on reconnect)
- OAuth 2.0 flow on hub for Claude.ai connector
- Per-API-key policy scoping (which agents, which tools, which capability levels)
- Audit log with hash chain integrity
- Dedicated `sonde` system user creation during agent install
- Group-based permission model (add to docker group, systemd-journal, etc.)

### Phase 3: Agent TUI (Week 7-8)
The OpenCode-like experience.

**Deliverables:**
- Ink-based installer TUI (system scan, pack selection, permission approval, enrollment)
- Ink-based management TUI (main screen, pack manager, activity log, audit viewer)
- Keyboard navigation, real-time updates
- `sonde` command launches TUI, `sonde --headless` for non-interactive

### Phase 4: Hub Dashboard (Week 9-11)
Web UI for fleet management.

**Deliverables:**
- React/Vite/Tailwind dashboard
- First-boot setup wizard
- Fleet overview (agent list, status, packs)
- Agent detail view (probes, history, audit)
- Enrollment page (generate token, show install command, live agent appear)
- API key management UI
- Policy editor UI
- Audit log viewer with search/filter
- "Try it" dry-run panel
- Real-time WebSocket updates to browser

### Phase 5: Hub Installer + Deployment Hardening (Week 12-13)
Make hub installation painless for non-Docker-experts.

**Deliverables:**
- Hub one-liner installer script (TUI: dependency check, Docker install, domain/TLS config)
- Cloudflare Tunnel integration in installer
- Let's Encrypt auto-configuration (via Caddy or Traefik)
- Tailscale/local-only mode
- Dokploy-ready compose file with Traefik labels
- "Deploy to Dokploy" button on website
- Hub auto-detects first boot, serves setup wizard
- Hub offers to install agent on same box during setup

### Phase 6: Polish + Public Launch Prep (Week 14-16)
Production hardening and public readiness.

**Deliverables:**
- Signed pack system (code signing in CI, agent verification)
- Pack registry / marketplace (basic: curated list on website)
- `sonde update` self-update mechanism for agent
- Hub upgrade notifications in dashboard
- Database migration system (run on startup)
- Comprehensive error handling and user-friendly error messages
- Documentation site (Starlight or Docusaurus)
- Landing page at sonde.dev
- stdio MCP bridge for Claude Code (`sonde mcp-bridge`)
- Additional packs: nginx, Postgres, Redis, MySQL

### Future Phases (post-launch)
- Syslog ingestion on hub (v2)
- External platform packs (Splunk, Elasticsearch, Loki, Datadog)
- GUI installer for agent (Electron or Tauri)
- Windows agent support
- OpenClaw integration
- Community pack submissions + review process
- Hub HA / clustering
- Cloud marketplace images (DO, AWS, Hetzner)
- Hosted SaaS offering

---

## CI/CD Pipeline

### Repository: GitHub (sonde-dev/sonde monorepo)

### Branch Strategy
- `main` — stable, always deployable, protected
- `dev` — integration branch, PRs merge here first
- `feature/*` — feature branches off dev
- `release/v*` — release branches cut from main
- `hotfix/*` — emergency fixes branched from main

### On Pull Request (ci.yml)

Triggered on every PR to `dev` or `main`:

```
1. Install dependencies (npm ci)
2. Turborepo pipeline:
   a. @sonde/shared     → type-check → lint → unit test
   b. @sonde/packs      → type-check → lint → unit test (depends on shared)
   c. @sonde/hub        → type-check → lint → unit test (depends on shared, packs)
   d. @sonde/agent      → type-check → lint → unit test (depends on shared, packs)
   e. @sonde/dashboard  → type-check → lint → unit test → build
3. Integration tests:
   a. Spin up hub + agent in Docker Compose (test environment)
   b. Run integration suite: agent enrollment, probe execution, MCP tool calls
   c. Tear down
4. Dashboard e2e tests (Playwright against test hub)
5. Report results + coverage
```

Turborepo caches aggressively — unchanged packages skip their pipeline steps.

### On Merge to main (release.yml)

Triggered when dev merges to main (or manual dispatch for hotfix):

```
1. Run full CI pipeline (same as PR)
2. Version bump:
   a. Changesets (https://github.com/changesets/changesets) manages versioning
   b. Each PR includes a changeset file describing the change
   c. On merge, changesets bot creates a "Version Packages" PR
   d. Merging that PR triggers publish
3. Build artifacts:
   a. Hub Docker image → push to ghcr.io/sonde-dev/hub:latest + :sha + :v{version}
   b. Agent npm package → publish @sonde/agent to npm
   c. Packs npm package → publish @sonde/packs to npm
   d. Shared npm package → publish @sonde/shared to npm
   e. Dashboard build → bundled into hub image (static assets)
4. GitHub Release:
   a. Create release with changelog (auto-generated from changesets)
   b. Attach agent install script
   c. Tag: v{version}
```

### Nightly Builds (nightly.yml)

Runs on cron (2am UTC) from main:

```
1. Full CI pipeline
2. Build + push: ghcr.io/sonde-dev/hub:nightly
3. Publish to npm with dist-tag "nightly": @sonde/agent@nightly
4. Run extended integration tests (longer timeouts, stress tests)
```

### Release Channels

- **stable** — tagged releases from main (v1.0.0, v1.1.0, etc.)
- **beta** — pre-release versions (@sonde/agent@beta, hub:beta)
- **nightly** — automatic daily builds from main tip

Agent config specifies channel:
```json
{
  "updateChannel": "stable"
}
```

### Hub Update Flow

```
Developer pushes code
  → PR to dev → CI checks pass → merge to dev
  → PR from dev to main → CI checks pass → merge to main
  → Changesets creates version PR → merge
  → GitHub Actions builds hub Docker image
  → Pushes to ghcr.io/sonde-dev/hub:v1.2.0 + :latest
  → Self-hosted users:
    - Watchtower auto-pulls new image and restarts
    - OR Dokploy webhook triggers redeploy from ghcr.io
    - OR manual: docker compose pull && docker compose up -d
  → Hub starts, detects database, runs any pending migrations
  → Hub dashboard shows "Updated to v1.2.0"
  → Hub checks connected agents' versions, flags outdated ones
```

### Agent Update Flow

```
New agent version published to npm (and as install script update)
  → Hub knows the latest agent version (checks npm registry or bundled manifest)
  → On agent WebSocket connect, hub compares agent's reported version to latest
  → If outdated:
    - Hub sends 'update_available' notification over WebSocket
    - Agent TUI shows update badge
    - Hub dashboard shows agent as "outdated" with version diff
  → User runs: sonde update
    - Agent downloads new version from npm (or binary from GitHub Releases)
    - Verifies checksum + signature
    - Replaces itself
    - Restarts systemd service
    - Reconnects to hub
    - Hub verifies new attestation fingerprint
  → Optional auto-update:
    - Agent config: "autoUpdate": true
    - Agent checks for updates on a schedule (daily)
    - Downloads, verifies, hot-swaps during low-activity window
    - Logs the update to audit trail
```

### Pack Update Flow

```
New pack version published to npm (@sonde/packs@1.3.0 includes docker pack v1.2.0)
  → Agent checks for pack updates: sonde packs update
    - Or auto-check on schedule if configured
  → Downloads new pack version
  → Verifies signature against Sonde signing key
  → If new permissions needed:
    - Pack enters "pending" state
    - TUI/CLI prompts for approval
  → If no new permissions: hot-swap, old pack unloaded, new pack loaded
  → Hub notified of updated pack version via heartbeat
  → Audit log entry for pack update
```

### CI/CD Infrastructure Diagram

```
GitHub Repo (sonde-dev/sonde)
  │
  ├─→ PR opened
  │     └─→ GitHub Actions: ci.yml
  │           ├── lint + type-check + unit tests (Turborepo)
  │           ├── integration tests (Docker Compose test env)
  │           └── e2e tests (Playwright)
  │
  ├─→ Merge to main + version PR merged
  │     └─→ GitHub Actions: release.yml
  │           ├── Build hub Docker image → ghcr.io
  │           ├── Publish @sonde/* packages → npm
  │           ├── Create GitHub Release + changelog
  │           └── Trigger downstream:
  │                 ├── Watchtower pulls new hub image
  │                 ├── Dokploy webhook redeploys
  │                 └── Agents see update_available
  │
  └─→ Nightly cron
        └─→ GitHub Actions: nightly.yml
              ├── Full CI + extended tests
              └── Publish :nightly tag
```

---

## Testing Strategy

### Unit Tests (Vitest)

Every package has unit tests co-located with source:

- `@sonde/shared`: Schema validation, cert generation, token creation, signing/verification
- `@sonde/hub`: MCP tool handlers (mocked agent responses), policy evaluation, runbook execution, API route handlers
- `@sonde/agent`: Probe execution (mocked system calls), pack loader, scrubber, config parsing
- `@sonde/packs`: Each probe function tested against mocked command output
- `@sonde/dashboard`: Component tests with React Testing Library

### Integration Tests

Docker Compose test environment spins up a real hub + agent:

- Agent enrollment flow (token → cert exchange → registration)
- Probe round-trip (MCP tool call → hub → agent → execute → response)
- Runbook execution (diagnose tool fires multiple probes)
- Policy enforcement (denied probe requests)
- Output scrubbing (inject secrets in probe output, verify they're stripped)
- Agent reconnection (kill connection, verify auto-reconnect)
- Agent attestation (modify agent fingerprint, verify hub flags it)

### E2E Tests (Playwright)

Dashboard tested against a real running hub:

- Setup wizard flow
- Agent appears in fleet view
- Enrollment token generation
- API key CRUD
- Audit log displays correctly

### Manual Testing Checklist (per release)

- Fresh install: hub on clean VPS via one-liner
- Fresh install: agent on separate machine, enroll to hub
- Claude.ai: add connector, run probe, verify result
- Claude Code: stdio bridge, run probe
- Pack install/uninstall via TUI
- Upgrade: hub image update, agent update, pack update
- Security: attempt unauthorized probe, verify rejection

---

## Open Questions
- Hosted SaaS pricing model vs pure open-source
- Community pack review/signing process details
- Domain name — sonde.dev availability, fallback options (sonde.sh, sondeai.dev, etc.)
- mTLS certificate rotation strategy (auto-rotate? manual? expiry period?)
- Hub HA / clustering for production SaaS deployments
- Agent attestation — what exactly triggers quarantine vs warning?
- Windows agent: equivalent of group-based access model (Windows ACLs, service accounts?)
- Syslog storage engine choice (embedded SQLite with rotation vs embedded Loki vs pluggable)
- Runbook format: currently defined in pack manifests as probe lists — is this sufficient or need a richer DSL?
- Pack distribution: npm only? Or also a Sonde-specific registry?
- Agent binary distribution: npm global install vs standalone binary (pkg/esbuild bundle)?

## Resolved Decisions
- ✅ Hub ↔ MCP client auth: OAuth 2.0 (SaaS) + API keys (self-hosted) + session tokens + client allowlisting
- ✅ Agent ↔ Hub auth: mTLS + single-use enrollment tokens + payload signing
- ✅ Agent privilege model: dedicated `sonde` user, group-based read access, never root
- ✅ Pack access model: manifest-declared requirements, explicit user approval, pending state until granted
- ✅ Architecture: hub-and-spoke, outbound-only WebSocket from agents
- ✅ Security layers: 9 layers (install/access, no raw shell, capability ceilings, wire security, MCP auth, output sanitization, signed packs, agent attestation, audit trail)
- ✅ Hub deployment: 4 paths (one-liner installer, Dokploy, manual Docker Compose, cloud images v2)
- ✅ Hub networking: 3 options (public domain + LE, Cloudflare Tunnel, local/Tailscale)
- ✅ Hub serves 4 interfaces from one process: MCP SSE, REST API, WebSocket (agents), Web Dashboard
- ✅ MCP client support: 4 tiers (Claude.ai SSE, Claude Code stdio bridge, other MCP platforms, REST API)
- ✅ Hub dashboard: web UI for fleet management, enrollment, policies, audit, "try it" dry-run panel
- ✅ Agent TUI: Ink-based interactive terminal app for install + ongoing management
- ✅ Tech stack locked: Hono, ws, better-sqlite3, Ink v5, Zod, Vitest, Biome, Turborepo, npm workspaces
- ✅ Monorepo: 5 packages (hub, agent, dashboard, packs, shared)
- ✅ Protocol schemas: Zod-defined message envelope, probe request/response, pack manifest, MCP tool I/O
- ✅ MVP defined: single `probe` tool, system pack (3 probes), API key auth, no TUI/dashboard
- ✅ Phased build plan: 7 phases (MVP → packs → auth → TUI → dashboard → deployment → launch)
- ✅ CI/CD: GitHub Actions, Turborepo pipeline, Changesets versioning, ghcr.io + npm publishing
- ✅ Branch strategy: main + dev + feature/* + release/* + hotfix/*
- ✅ Release channels: stable, beta, nightly
- ✅ Update flows defined: hub (Docker image), agent (npm + self-update), packs (npm + signature verify)
