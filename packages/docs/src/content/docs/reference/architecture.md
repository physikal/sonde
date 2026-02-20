---
title: Architecture
---

Sonde uses a hub-and-spoke model. A central hub serves as the MCP endpoint for AI clients, while lightweight agents run on target machines and connect outbound via WebSocket.

## Components

### Hub

The hub is a single Node.js process exposing four interfaces:

- **MCP StreamableHTTP** at `/mcp` -- for AI clients (Claude, etc.)
- **REST API** at `/api/v1/*` -- for the dashboard and programmatic access
- **WebSocket** at `/ws/agent` -- for agent connections
- **Dashboard SPA** -- React app served as static assets

Backed by SQLite for persistence (agents, audit log, API keys, OAuth state, setup wizard).

### Agent

A lightweight daemon installed on each target machine. Key properties:

- Connects **outbound** to the hub via WebSocket. Never listens on a port.
- Runs as a dedicated `sonde` user, never as root.
- Executes only structured probes from loaded packs. No raw shell execution.
- Scrubs sensitive data from output before sending to the hub.
- Attests its environment (OS, binary hash, pack list) at enrollment and reconnection.

### Packs

Capability plugins that declare available probes. Each pack defines:

- Probe name, description, and parameters (Zod schema)
- Required system permissions (groups, paths)
- The execution logic mapping probe descriptors to local commands

All probes are strictly read-only. Sonde never modifies, restarts, or changes anything on your infrastructure.

## Communication Flow

```
1. Agent starts and connects to hub via WebSocket
2. Agent sends agent.register (name, OS, version, packs, attestation)
3. Hub acknowledges with hub.ack (assigns agentId)
4. Agent sends heartbeats every 30 seconds
5. Claude sends MCP tool call to hub (e.g., probe "system.disk.usage" on "my-server")
6. Hub routes probe.request to the target agent via WebSocket
7. Agent executes the probe locally, scrubs output
8. Agent sends probe.response back through the hub
9. Hub returns structured result to Claude via MCP
```

## MCP Tools

The hub exposes these tools to AI clients via the MCP protocol:

| Tool | Description |
|------|-------------|
| `health_check` | Start here for broad "is something wrong?" questions. Runs all applicable diagnostics in parallel. Supports tag filtering to scope to a group (e.g. `#prod`, `#storefront`). |
| `list_capabilities` | Discover all agents, integrations, their individual probes, and diagnostic categories. Use to find what specific probes are available for follow-up. |
| `diagnose` | Deep investigation of a specific category on an agent or integration (e.g. "check docker on server-1"). |
| `probe` | Run a single targeted probe for a specific measurement. Good for follow-up after diagnose. |
| `list_agents` | List all agents with connection status, packs, and tags. |
| `agent_overview` | Detailed info for a specific agent (OS, uptime, packs, recent probes). |
| `query_logs` | Investigate root cause by checking logs (Docker, systemd, nginx) or the hub audit trail. |

## Design Rules

- **Outbound only.** Agents initiate all connections. No inbound ports required on target machines.
- **No raw shell.** Only structured probe descriptors are accepted. There is no code path from MCP to arbitrary shell execution.
- **Schema validated.** All protocol messages are validated with Zod schemas from `@sonde/shared`.
- **Structured output.** Probes return typed JSON objects, never raw text.
- **Concurrent probes.** Multiple probes can execute simultaneously on the same agent, correlated by `requestId`.

## Monorepo Packages

| Package | Description |
|---------|-------------|
| `@sonde/shared` | Protocol Zod schemas, types, crypto utilities (signing) |
| `@sonde/packs` | Pack definitions (system, docker, systemd, and more) |
| `@sonde/hub` | MCP server, WebSocket server, SQLite DB, policy engine, dashboard serving |
| `@sonde/agent` | WebSocket client, probe executor, CLI, TUI, scrubber, attestation |
| `@sonde/dashboard` | React 19 SPA (setup wizard and dashboard UI) |
| `@sonde/docs` | Documentation site (Starlight) |

### Dependency Graph

```
@sonde/shared
    |
    v
@sonde/packs
   /    \
  v      v
hub    agent

dashboard (independent -- no @sonde/* dependencies)
```

`@sonde/shared` is the foundation. `@sonde/packs` depends on shared for schemas. Both hub and agent depend on packs. The dashboard is a standalone React app with no monorepo dependencies.
