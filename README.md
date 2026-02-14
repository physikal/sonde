# Sonde

AI infrastructure agent system. AI assistants (Claude, etc.) gather info from remote servers for troubleshooting via MCP.

**Hub** = central MCP server. **Agents** = lightweight daemons on target machines connecting outbound via WebSocket. **Packs** = capability plugins defining available probes.

> Phase 0 — MVP. End-to-end proof of concept.

## Architecture

```
Claude / AI ──MCP──▸ Hub ──WebSocket──▸ Agent ──probe──▸ OS
                      │                    │
                   SQLite              Pack: system
                   (audit)          (disk, memory, cpu)
```

- Agents connect **outbound** to the hub — never listen on a port
- Agents never execute raw shell commands — structured probe descriptors only
- All protocol messages validated with Zod schemas

## Prerequisites

- Node.js 22+
- npm 10+

## Quick Start

```bash
# Install dependencies
npm install

# Build all packages
npm run build
```

### 1. Start the Hub

```bash
SONDE_API_KEY=test-key-123 node packages/hub/dist/index.js
```

The hub starts on `http://localhost:3000` with:
- `/health` — health check
- `/mcp` — MCP endpoint (StreamableHTTP)
- `/ws/agent` — WebSocket for agent connections

### 2. Enroll and Start an Agent

In a second terminal:

```bash
node packages/agent/dist/index.js enroll \
  --hub http://localhost:3000 \
  --key test-key-123 \
  --name my-server

node packages/agent/dist/index.js start
```

The agent connects to the hub, registers its packs (system), and waits for probe requests.

### 3. Test the MCP Endpoint

With the hub and agent running, test via curl:

```bash
# Initialize an MCP session
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer test-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "capabilities": {},
      "clientInfo": { "name": "test", "version": "0.1.0" }
    }
  }'
```

Note the `mcp-session-id` header in the response, then call a probe:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer test-key-123" \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: <session-id-from-above>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "probe",
      "arguments": {
        "agent": "my-server",
        "probe": "system.disk.usage"
      }
    }
  }'
```

### 4. Use with Claude

Add the MCP endpoint in Claude's settings:

- **URL:** `http://localhost:3000/mcp`
- **Auth header:** `Bearer test-key-123`

Then ask: *"What's the disk usage on my-server?"*

## Docker

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

This starts the hub on port 3000 with API key `test-key-123`. Then enroll an agent from the host as shown above.

## Development

```bash
# Type-check, lint, and test all packages
npm run typecheck
npm run lint
npm run test

# Run everything via Turborepo
npm run build

# Integration tests (requires Docker)
npm run test:integration

# Format code
npm run format
```

## Monorepo Packages

| Package | Description |
|---------|-------------|
| `@sonde/shared` | Protocol Zod schemas, types, constants |
| `@sonde/packs` | Probe capability plugins (system pack) |
| `@sonde/hub` | MCP server, WebSocket server, SQLite |
| `@sonde/agent` | WebSocket client, probe executor, CLI |
| `@sonde/dashboard` | React frontend (Phase 4+) |

## Available Probes

**System pack** (`system`):
- `system.disk.usage` — filesystem usage (df)
- `system.memory.usage` — memory stats (free)
- `system.cpu.usage` — CPU load averages + core count

## License

Private — all rights reserved.
