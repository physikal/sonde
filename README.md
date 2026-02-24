# Sonde

[![CI](https://github.com/physikal/sonde/actions/workflows/ci.yml/badge.svg)](https://github.com/physikal/sonde/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@sonde/agent)](https://www.npmjs.com/package/@sonde/agent)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

**AI infrastructure agent.** Give Claude eyes into your servers.

Sonde is a hub-and-spoke system that lets AI assistants gather diagnostic data from remote infrastructure. The hub serves an MCP endpoint that Claude (or any MCP client) connects to. Lightweight agents run on target machines, connecting outbound via WebSocket. Integration packs connect to enterprise systems (ServiceNow, Citrix, Proxmox, Splunk, etc.) directly from the hub — no agent required.

```
Claude ──MCP──▸ Hub ──WebSocket──▸ Agent ──probe──▸ Server
                 │
                 ├── SQLite (audit, config, sessions)
                 ├── 8 agent packs (35 probes)
                 ├── 19 integration packs
                 └── Dashboard (React SPA)
```

## Quick Start

### 1. Deploy the Hub

```bash
docker run -d --name sonde-hub \
  -p 3000:3000 \
  -e SONDE_SECRET=your-secret-key-min-16-chars \
  -e SONDE_ADMIN_USER=admin \
  -e SONDE_ADMIN_PASSWORD=your-admin-password \
  -v sonde-data:/data \
  ghcr.io/physikal/hub:latest
```

Open `http://localhost:3000` to access the dashboard and complete the setup wizard. The wizard creates an admin account and generates your first API key.

**Windows:** Download the `.msi` installer from [GitHub Releases](https://github.com/physikal/sonde/releases). It bundles Node.js, the hub, dashboard, and installs as a Windows service. See the [Windows deployment docs](https://sondeapp.com/hub/deployment/#windows-msi) for details.

### 2. Install an Agent

From the dashboard, go to **Manage > Enrollment**, generate a token, and run the displayed command on your target machine:

```bash
curl -fsSL https://your-hub:3000/install | bash
```

This installs Node.js 22 and `@sonde/agent`, then prints instructions to run the interactive setup. If your terminal supports it, the TUI launches automatically.

Or install manually with npm:

```bash
npm install -g @sonde/agent
sonde enroll --hub https://your-hub:3000 --token <enrollment-token>
sonde start --headless
```

Each agent gets a unique name by default (`hostname-<random>`) to prevent identity collisions. Override with `--name` if needed.

### 3. Connect Claude

You need an API key to connect. Create one in the dashboard at **Manage > API Keys** (admin) or **My API Keys** (self-service, up to 5 per user).

**Claude Code:**

```bash
claude mcp add sonde --transport http https://your-hub:3000/mcp \
  --header "Authorization: Bearer your-api-key"
```

**Claude Desktop** — add to config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sonde": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-hub:3000/mcp",
        "--header",
        "Authorization: Bearer your-api-key"
      ]
    }
  }
}
```

Then ask: *"What's the disk usage on my-server?"*

## MCP Tools

| Tool | Description |
|------|-------------|
| `health_check` | Broad diagnostics — runs all applicable probes in parallel. Start here. |
| `list_capabilities` | Discover agents, integrations, probes, diagnostic categories, and critical paths. |
| `diagnose` | Deep investigation of a category on an agent or integration. |
| `probe` | Run a single targeted probe for a specific measurement. |
| `list_agents` | List all agents with status, packs, and tags. |
| `agent_overview` | Detailed info for a specific agent. |
| `query_logs` | Query logs from agents (Docker, systemd, nginx) or the hub audit trail. |
| `check_critical_path` | Execute a predefined infrastructure checkpoint chain (e.g. LB → web → app → DB). |
| `trending_summary` | Aggregate probe trends from the last 24h — failure rates, error patterns, hot spots. |

Use `#tagname` syntax in prompts to filter by tags (e.g., *"Show me #prod agents"*).

## Agent Packs

| Pack | Probes | Description |
|------|--------|-------------|
| **system** | `disk.usage`, `memory.usage`, `cpu.usage`, `network.ping`, `network.traceroute`, `logs.journal`, `logs.dmesg`, `logs.tail` | OS metrics and network diagnostics |
| **docker** | `containers.list`, `logs.tail`, `images.list`, `daemon.info` | Docker containers and images |
| **systemd** | `services.list`, `service.status`, `journal.query` | systemd services and journals |
| **nginx** | `config.test`, `access.log.tail`, `error.log.tail` | Nginx config and logs |
| **postgres** | `databases.list`, `connections.active`, `query.slow` | PostgreSQL databases and queries |
| **redis** | `info`, `keys.count`, `memory.usage` | Redis server stats |
| **mysql** | `databases.list`, `processlist`, `status` | MySQL databases and processes |
| **proxmox-agent** | `vm.config`, `ha.status`, `lvm`, `ceph.status`, `lxc.config`, `lxc.list`, `cluster.config`, `vm.locks` | Proxmox host-level diagnostics |

8 packs, 35 probes. Agents auto-detect installed software and suggest relevant packs.

## Integration Packs

Server-side packs that connect to enterprise systems directly from the hub — no agent required. All read-only.

| Pack | Description |
|------|-------------|
| **servicenow** | Incidents, CIs, change requests |
| **citrix** | Endpoint management, delivery groups |
| **proxmox** | VMs, nodes, cluster status |
| **vcenter** | VMware vSphere VMs and hosts |
| **nutanix** | Hyperconverged infrastructure |
| **splunk** | Log search and alerts |
| **datadog** | Monitors, metrics, events |
| **loki** | Grafana Loki log queries |
| **jira** | Issues and projects |
| **pagerduty** | Incidents and services |
| **thousandeyes** | Network monitoring tests |
| **meraki** | Cisco Meraki networks and devices |
| **checkpoint** | Security gateways and policies |
| **a10** | Load balancer virtual servers |
| **unifi** | UniFi network devices and clients |
| **unifi-access** | UniFi Access door controllers |
| **graph** | Microsoft Graph / Entra ID |
| **keeper** | Keeper Secrets Manager |
| **httpbin** | Reference integration for testing |

Configure integrations in the dashboard at **Manage > Integrations** with encrypted credential storage (AES-256-GCM).

## Dashboard

Web-based management UI served by the hub. Features:

- **Fleet** — Real-time agent status, tags, bulk operations, search
- **Enrollment** — Token generation with one-liner install commands
- **API Keys** — Admin key management with role and policy scoping
- **My API Keys** — Self-service key creation for members (up to 5 per user)
- **Policies** — Per-key access restrictions (agents, probes, clients) with search and inline editing
- **Integrations** — Configure and test enterprise system connections
- **Users & Groups** — Individual users and Entra security group authorization
- **Access Groups** — Optional scoping to restrict users to specific agents/integrations
- **Critical Paths** — Define and execute infrastructure checkpoint chains
- **Trending** — Probe success/failure trends, error patterns, AI-powered analysis
- **Audit** — Searchable, hash-chained tamper-evident audit log
- **Try It** — Interactive probe testing without an AI client
- **Settings** — SSO configuration, AI model settings, MCP prompt customization, tag management

Three-tier RBAC: **member** (MCP only), **admin** (MCP + dashboard), **owner** (admin + SSO/settings). Supports local login and Entra ID SSO.

## Security

Defense-in-depth across nine layers: dedicated unprivileged user, no raw shell execution, mTLS, payload signing (RSA-SHA256), output scrubbing, agent attestation, policy engine (per-key agent/probe/client restrictions), Zod schema validation at every boundary, and tamper-evident hash-chained audit logging.

All probes are read-only. Agents never listen on a port. There is no code path from any external input to arbitrary shell execution. See the [Security Model](https://sondeapp.com/reference/security/) docs.

## Monorepo

| Package | Description |
|---------|-------------|
| [`@sonde/shared`](packages/shared) | Protocol Zod schemas, types, crypto utils |
| [`@sonde/packs`](packages/packs) | Pack definitions (8 agent + 19 integration packs) |
| [`@sonde/hub`](packages/hub) | MCP server, WebSocket, DB, REST API, dashboard serving |
| [`@sonde/agent`](packages/agent) | WebSocket client, probe executor, CLI, TUI |
| [`@sonde/dashboard`](packages/dashboard) | React 19 SPA (setup wizard + dashboard) |
| [`@sonde/docs`](packages/docs) | Documentation site (Starlight) |

## Development

```bash
npm install          # Install all workspace dependencies
npm run build        # Build all packages
npm run test         # Run tests
npm run typecheck    # Type-check
npm run lint         # Lint with Biome
```

Requires Node.js 22+ and npm 10+. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development guide.

## Documentation

Full documentation at [sondeapp.com](https://sondeapp.com).

## License

[Apache 2.0](LICENSE)
