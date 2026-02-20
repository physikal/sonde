# Sonde Architecture

## Hub & Spoke Model

- **Sonde Hub** — Central MCP server ("ground station"). Single endpoint that MCP clients connect to.
- **Sondes (Agents)** — Lightweight agents on target machines. Connect outbound to hub via WebSocket.
- **Packs** — Capability plugins defining what probes an agent can run (Docker, systemd, etc.)
- **Readings** — Probe results returned from agents.
- **Runbooks** — Diagnostic workflows orchestrating multiple probes for a problem category.

## Communication Flow

1. Agent initiates outbound WebSocket connection to Hub (persistent, bidirectional)
2. Claude sends MCP tool call to Hub
3. Hub relays structured probe descriptor to agent over existing WebSocket
4. Agent executes mapped read-only command locally
5. Output passes through scrubbing pipeline
6. Result returns to Hub → Hub returns to Claude

Agents NEVER listen on a port. Outbound-only. Reconnect with exponential backoff on drop.

## Hub Interfaces (four from one process)

| Interface | Endpoint | Purpose |
|-----------|----------|---------|
| MCP StreamableHTTP | `/mcp` | Claude.ai and MCP-native clients |
| REST API | `/api/v1/*` | Custom integrations, bots, OpenClaw |
| WebSocket | `/ws/agent` | Agent connections |
| Web Dashboard | `/dashboard` | Human management (Phase 4+) |

All share the same auth layer, policy engine, and audit system.

## MCP Tool Design

High-level, intent-driven tools (not raw probe wrappers):

| Tool | Purpose |
|------|---------|
| `list_agents` | Shows online machines and installed packs |
| `agent_overview` | Quick health snapshot of a specific agent |
| `diagnose` | Problem description + target → runs probe battery → consolidated report |
| `probe` | Targeted single probe for follow-up |
| `query_logs` | Search across all log access patterns |

## Diagnostic Workflow Example

User: "My docker isn't working on gmtek01"

1. Claude calls `diagnose` with `{ agent: "gmtek01", category: "docker" }`
2. Hub fires runbook probes in parallel: daemon status, containers, logs, disk, memory
3. Hub assembles structured report, returns in ONE MCP tool call
4. Claude reads report, identifies root cause, tells user how to fix
5. If needed, Claude uses `probe` for targeted follow-up

## Log Access Patterns

Three complementary ways to access logs:

1. **Agent Probes** — tail logs directly on box (docker.logs.tail, journalctl)
2. **Syslog Ingestion** (v2) — hub captures logs from devices that can't run agents
3. **External Platform Packs** — query Splunk, Elasticsearch, Loki, Datadog where logs already live

## MCP Client Connectivity

**Tier 1: Claude.ai** — Remote MCP via SSE, OAuth 2.0 auth
**Tier 2: Claude Code** — stdio MCP bridge (`sonde mcp-bridge`)
**Tier 3: Other AI platforms** — SSE if supported, adapter bridges otherwise
**Tier 4: REST API** — Any HTTP client, API key auth

## Branding

- **Name:** Sonde (from radiosonde — instrument package sent to gather data and transmit back)
- **Tagline:** "Launch a Sonde into your infrastructure. Let AI read the data."
- **Domain targets:** sonde.dev, sonde.sh, sondeai.dev
- **npm org:** @sonde
- **GitHub:** physikal/sonde
