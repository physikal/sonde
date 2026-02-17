# Sonde

[![CI](https://github.com/sonde-dev/sonde/actions/workflows/ci.yml/badge.svg)](https://github.com/sonde-dev/sonde/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@sonde/agent)](https://www.npmjs.com/package/@sonde/agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**AI infrastructure agent.** Give Claude eyes into your servers.

Sonde is a hub-and-spoke system that lets AI assistants gather information from remote infrastructure for troubleshooting. The hub serves an MCP endpoint that Claude (or any MCP client) connects to. Lightweight agents run on target machines, connecting outbound via WebSocket. Packs define the available probes — structured, read-only operations that return JSON.

```
Claude ──MCP──▸ Hub ──WebSocket──▸ Agent ──probe──▸ Server
                 │                    │
              SQLite              7 Packs
              (audit)        (25 built-in probes)
```

## Quick Start

### 1. Deploy the Hub

```bash
docker run -d --name sonde-hub \
  -p 3000:3000 \
  -e SONDE_API_KEY=your-secret-key-min-16-chars \
  -v sonde-data:/data \
  ghcr.io/sonde-dev/hub:latest
```

### 2. Install an Agent

```bash
curl -fsSL https://sondeapp.com/install | bash
```

Or with npm:

```bash
npm install -g @sonde/agent
sonde enroll --hub https://your-hub:3000 --token <enrollment-token>
sonde start --headless
```

### 3. Connect Claude

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

## Available Packs

| Pack | Probes | Description |
|------|--------|-------------|
| **system** | `disk.usage`, `memory.usage`, `cpu.usage` | OS metrics |
| **docker** | `containers.list`, `logs.tail`, `images.list`, `daemon.info` | Docker containers and images |
| **systemd** | `services.list`, `service.status`, `journal.query` | systemd services and journals |
| **nginx** | `config.test`, `access.log.tail`, `error.log.tail` | Nginx config and logs |
| **postgres** | `databases.list`, `connections.active`, `query.slow` | PostgreSQL databases and queries |
| **redis** | `info`, `keys.count`, `memory.usage` | Redis server stats |
| **mysql** | `databases.list`, `processlist`, `status` | MySQL databases and processes |

7 packs, 25 probes. Agents auto-detect installed software and suggest relevant packs.

## Security

Nine-layer defense-in-depth: dedicated unprivileged user, no raw shell execution, capability ceilings, mTLS, payload signing, output scrubbing, pack signing, agent attestation, and tamper-evident audit logging. See the [Security Model](https://sondeapp.com/reference/security/) docs.

## Monorepo

| Package | Description |
|---------|-------------|
| [`@sonde/shared`](packages/shared) | Protocol Zod schemas, types, crypto utils |
| [`@sonde/packs`](packages/packs) | Pack definitions (7 built-in packs) |
| [`@sonde/hub`](packages/hub) | MCP server, WebSocket, DB, dashboard serving |
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

[MIT](LICENSE)
