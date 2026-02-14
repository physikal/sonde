# Sonde — AI Infrastructure Agent

## What Is This

Hub-and-spoke MCP agent system. AI assistants (Claude, etc.) gather info from remote infrastructure for troubleshooting. Read-only by default, secure by design, easy to deploy.

Hub = central MCP server. Agents = lightweight daemons on target machines connecting outbound via WebSocket. Packs = capability plugins defining available probes.

## Tech Stack

- **Language:** TypeScript, Node.js 22 LTS
- **Monorepo:** npm workspaces + Turborepo
- **Hub:** Hono (HTTP/SSE/REST) + ws (WebSocket) + better-sqlite3
- **Agent:** ws client, Ink v5 TUI (Phase 3+)
- **Dashboard:** React 19 + Vite + Tailwind (Phase 4+)
- **MCP:** @modelcontextprotocol/sdk
- **Schemas:** Zod everywhere
- **Logging:** pino
- **Testing:** Vitest (unit/integration) + Playwright (e2e)
- **Linting:** Biome
- **Docker:** node:22-alpine → ghcr.io/sonde-dev/hub
- **CI:** GitHub Actions + Turborepo + Changesets

## Monorepo Packages

- `@sonde/shared` — Protocol Zod schemas, types, crypto utils
- `@sonde/packs` — Official pack definitions (system, docker, systemd, etc.)
- `@sonde/hub` — MCP SSE server, WebSocket server, runbook engine, policy engine, REST API
- `@sonde/agent` — WebSocket client, pack loader, probe executor, CLI, TUI
- `@sonde/dashboard` — React frontend (builds to static assets served by hub)

Dependency graph: shared → packs → hub + agent. Dashboard is independent.

## Branch Strategy

- `main` — stable, protected, always deployable
- `dev` — integration branch, PRs merge here
- `feature/*` — off dev
- `hotfix/*` — off main

## Current Phase: Phase 0 — MVP

**Goal:** End-to-end proof of concept. Claude asks about a server, gets an answer through Sonde.

**MVP scope only:**
- Hub: Hono + MCP StreamableHTTP (`/mcp`) + WebSocket (`/ws/agent`) + health check (`/health`)
- Auth: API key from env var `SONDE_API_KEY`
- One MCP tool: `probe`
- One pack: `system` (disk.usage, memory.usage, cpu.usage)
- No mTLS, no TUI, no scrubbing, no dashboard, no OAuth
- SQLite: agents table + audit_log table, migrations on startup
- Agent: CLI (enroll + start), WebSocket client, heartbeats, exponential backoff reconnect
- Docker Compose for hub

**MVP demo flow:**
1. `docker compose up` (hub)
2. `sonde enroll --hub http://localhost:3000 --key test-key-123`
3. `sonde start`
4. Add MCP URL to Claude.ai → "What's the disk usage?"
5. Claude calls probe → hub routes to agent → result → Claude answers

## Key Architecture Rules

- Agents connect OUTBOUND to hub (WebSocket). Never listen on a port.
- Agent NEVER executes raw shell commands. Structured probe descriptors only.
- Packs declare probes. Agent maps descriptors to local commands internally.
- All protocol messages validated with Zod schemas from @sonde/shared.
- Hub routes probe requests to agents by name/ID.
- Probes return structured JSON, never raw text.

## Reference Docs

Detailed specs live in `/docs/` — read these when working on specific areas:

- `docs/ARCHITECTURE.md` — Full architecture, communication flow, security model (9 layers)
- `docs/PROTOCOL.md` — WebSocket message envelope, probe request/response, pack manifest Zod schemas
- `docs/PHASES.md` — Full phased build plan (Phase 0-6) with deliverables per phase
- `docs/CICD.md` — GitHub Actions workflows, release process, update flows (hub/agent/pack)
- `docs/DEPLOYMENT.md` — Hub deployment paths, agent install, TUI mockups, UX design
- `docs/SECURITY.md` — All 9 security layers, agent privilege model, mTLS, attestation

## Project Structure (Phase 0)

```
sonde/
├── package.json
├── turbo.json
├── tsconfig.base.json
├── biome.json
├── .github/workflows/
│   ├── ci.yml
│   └── release.yml (scaffold)
├── docker/
│   ├── hub.Dockerfile
│   └── docker-compose.yml
├── docs/                          # Detailed reference docs
├── packages/
│   ├── shared/src/
│   │   ├── schemas/               # protocol.ts, probes.ts, packs.ts, mcp.ts
│   │   ├── types/                 # common.ts, agent.ts, hub.ts
│   │   └── index.ts
│   ├── hub/src/
│   │   ├── index.ts               # Entry: starts Hono + WS
│   │   ├── mcp/server.ts          # MCP StreamableHTTP via SDK
│   │   ├── mcp/tools/probe.ts     # probe tool handler
│   │   ├── mcp/auth.ts            # API key validation
│   │   ├── ws/server.ts           # WebSocket for agents
│   │   ├── ws/dispatcher.ts       # Route probes to agents
│   │   ├── db/index.ts            # better-sqlite3 setup + migrations
│   │   └── config.ts
│   ├── agent/src/
│   │   ├── index.ts               # CLI entry (enroll, start, status)
│   │   ├── runtime/connection.ts  # WS client + heartbeat + reconnect
│   │   ├── runtime/executor.ts    # Maps probe requests → pack functions
│   │   └── config.ts
│   └── packs/src/
│       ├── types.ts               # Pack interface
│       ├── index.ts               # Pack registry
│       └── system/
│           ├── manifest.json
│           └── probes/            # disk-usage.ts, memory-usage.ts, cpu-usage.ts
```

## File Conventions

- Probe functions: take params object, return structured data (not raw stdout)
- Schemas: all Zod, exported from @sonde/shared
- Tests: co-located (`*.test.ts` next to source), use Vitest
- Config: env vars for runtime, Zod-validated
- Logging: pino, structured JSON

## Implementation Notes (Phase 0)

- **MCP transport**: Using `StreamableHTTPServerTransport` + `McpServer.registerTool()` from MCP SDK (not deprecated SSE/`.tool()` APIs)
- **Hub routing**: Raw Node HTTP server routes `/mcp` → MCP handler, rest → Hono via `getRequestListener`. Per-session McpServer instances.
- **Probe testability**: ExecFn injection — probe handlers accept `(params, exec)` where `exec` is `(cmd, args) => Promise<string>`. Tests mock `exec`.
- **Dispatcher**: MVP uses one pending probe per agent (`Map<agentId, PendingRequest>`). Will need request-ID correlation for concurrent probes.
- **Auth**: `extractApiKey()` checks Bearer header first, falls back to `?apiKey` query param.
