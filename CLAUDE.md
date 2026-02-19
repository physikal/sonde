# Sonde — AI Infrastructure Agent

## Why Sonde Exists

During an outage, an engineer connects their AI assistant (Claude, GPT, etc.) to Sonde via MCP and asks natural language questions like "What's wrong with the storefront servers?" or "Who owns these machines?" Sonde reaches across agents on infrastructure and integrations with enterprise systems (ServiceNow, Citrix, Entra, etc.) to gather diagnostic data and bring back answers. No SSH, no jumping between dashboards, no tribal knowledge required. The AI does the investigation.

## How It Works

Hub-and-spoke MCP agent system. Read-only by default, secure by design, easy to deploy.

Hub = central MCP server. Agents = lightweight daemons on target machines connecting outbound via WebSocket. Packs = capability plugins defining available probes.

## Tech Stack

- **Language:** TypeScript, Node.js 22 LTS
- **Monorepo:** npm workspaces + Turborepo
- **Hub:** Hono (HTTP/REST) + ws (WebSocket) + better-sqlite3 + static dashboard serving
- **Agent:** ws client, Ink v5 TUI, privilege dropping, attestation
- **Dashboard:** React 19 + Vite 6 + Tailwind v4 (PostCSS)
- **MCP:** @modelcontextprotocol/sdk
- **Schemas:** Zod everywhere
- **Logging:** pino
- **Testing:** Vitest (unit/integration) + Playwright (e2e)
- **Linting:** Biome
- **Docker:** node:22-alpine → ghcr.io/physikal/hub
- **CI:** GitHub Actions + Turborepo + Changesets

## Monorepo Packages

- `@sonde/shared` — Protocol Zod schemas, types, crypto utils (signing)
- `@sonde/packs` — Official pack definitions (system, docker, systemd)
- `@sonde/hub` — MCP server, WebSocket server, runbook engine, policy engine, OAuth, REST API, dashboard serving
- `@sonde/agent` — WebSocket client, pack loader, probe executor, CLI, TUI, scrubber, attestation
- `@sonde/dashboard` — React 19 SPA (setup wizard + dashboard UI, builds to static assets served by hub)

Dependency graph: shared → packs → hub + agent. Dashboard is independent (no @sonde/* deps).

## Branch Strategy

- `main` — stable, protected, always deployable
- `dev` — integration branch, PRs merge here
- `feature/*` — off dev
- `hotfix/*` — off main

## Completed Phases

### Phase 0 — MVP
End-to-end proof of concept. Hub (Hono + MCP StreamableHTTP + WebSocket), agent CLI (enroll + start), system pack (disk/memory/cpu), Docker Compose, CI/CD.

### Phase 1 — Docker & CI
Docker multi-stage build, GitHub Actions CI, integration test, README.

### Phase 2 — Security & Policy
mTLS (hub CA, agent certs), payload signing (RSA-SHA256), output scrubbing, agent attestation, OAuth 2.0 (dynamic client registration + PKCE), policy engine (allow/deny rules per API key), audit log with SHA-256 hash chain.

### Phase 3 — Agent TUI & Management
Agent management TUI (Ink v5), installer TUI, pack management CLI, privilege dropping, enrollment tokens.

### Phase 4 — Hub Dashboard
React 19 + Vite + Tailwind v4 SPA served by hub. 5-step setup wizard (Welcome, API Key, AI Tools, Agent Enroll, Complete). App shell with sidebar navigation. Overview dashboard with hub health + agent count. Fleet page with real-time agent status. Agent detail page with probe history. Enrollment page with token generation and one-liner install commands. Try It page for interactive probe execution. Setup state persisted in SQLite `setup` table. Hub serves static assets with SPA fallback for client-side routing.

### Phase 4.5 — Production Hardening
Agent installer route (`GET /install` — `curl | bash` bootstrap). Token-only enrollment (no master API key required for agents). Hub mints scoped API keys during token enrollment for persistent agent auth. Stable agent identity (reuse UUID on re-enrollment by name). Concurrent probe support via requestId correlation. Dynamic version from package.json. Stale socket cleanup on agent reconnect. Dashboard real-time status via WebSocket broadcast. Changesets wired for versioning/publishing.

### Phase 6 — Docs
Astro + Starlight docs site (`@sonde/docs`). Getting started guide, hub/agent/pack docs, AI integration guides, architecture/protocol/security/API reference.

### Phase 7 — Integration Framework
Server-side integration packs (no agent required). Integration types in `@sonde/shared`. `IntegrationExecutor` with retry/timeout, `IntegrationManager` with encrypted credential storage (AES-256-GCM), `ProbeRouter` (routes to agent dispatcher or integration executor). httpbin reference pack with ip/headers/status probes. Pack catalog pattern fixes bootstrapping bug. REST CRUD endpoints for integrations. Dashboard Integrations + IntegrationDetail pages.

### Phase 8a.0–8a.0b — Session Auth + Encryption Separation
Replaced HTTP Basic Auth with session-based authentication. Sessions table with sliding 8hr window. `SessionManager` class. Cookie-based session middleware + API key auth middleware (combined: session first, API key fallback). Local admin login via `SONDE_ADMIN_USER`/`SONDE_ADMIN_PASSWORD` env vars. Auth routes: `POST /auth/local/login`, `GET /auth/status`, `DELETE /auth/session`. Dashboard: Login page, `AuthProvider`/`useAuth` hook, auth guard in App router, TopBar with user info + role badge + logout. Removed `ApiKeyGate` and `useApiKey` — all dashboard pages use `apiFetch()` with session cookie auth. Separated `SONDE_SECRET` from API keys (dedicated encryption root of trust). Removed capability levels (Unlimited/Observe/Interact/Manage) — superseded by RBAC roles. API keys now managed entirely from dashboard (no hardcoded master key).

### Phase 8a.1 — Entra OIDC
Entra ID SSO via OpenID Connect authorization code flow. SSO config stored in `sso_config` table (encrypted client_secret via existing crypto module). OIDC scopes: `openid profile email User.Read GroupMember.Read.All`. Login page shows "Sign in with Microsoft" when SSO configured. Callback exchanges auth code for tokens, extracts id_token claims. Currently uses group_role_mappings for role resolution — **8a.2 migrates this to dual authorization model** (see Design Decisions below).

**Current phase: 8a.2** — RBAC engine, authorized users + groups, access groups.

## Key Architecture Rules

- Agents connect OUTBOUND to hub (WebSocket). Never listen on a port.
- Agent NEVER executes raw shell commands. Structured probe descriptors only.
- Packs declare probes. Agent maps descriptors to local commands internally.
- All protocol messages validated with Zod schemas from @sonde/shared.
- Hub routes probe requests to agents by name/ID.
- Probes return structured JSON, never raw text.

## Design Decisions & Constraints

These decisions are final. Do not redesign or re-litigate them.

### Roles (Three-Tier)

- **member** — MCP access only. Cannot access the Hub dashboard. Connects via Claude Desktop / Claude Code with an API key. Full diagnostic capability — can query any agent, any integration. This is the default role for SMEs.
- **admin** — MCP access + Hub dashboard. Can enroll agents, manage integrations, manage users/groups, create API keys. The people who run the Sonde deployment.
- **owner** — Admin + SSO configuration + hub settings. Typically 1-2 people. The bootstrap admin (env vars) is always owner.

All roles have identical diagnostic query capability. Roles only control platform administration access.

### Dual Authorization (Entra SSO)

Two ways to authorize users, usable independently or together:

1. **Authorized Users** — admin adds individuals by email in the dashboard, assigns a role. Good for small teams or external contractors.
2. **Authorized Groups** — admin maps an Entra security group ID to a default role. Good for large teams (point at SG-Sonde-Users instead of adding 50 emails).

On SSO login, the callback checks both sources and takes the **highest** role. If neither matches, access denied. The Graph API call to `/me/memberOf` is conditional — only runs if `authorized_groups` has rows.

Users authorized via group only are auto-created in `authorized_users` on first login (with `created_by='auto:entra_group'`).

### Access Groups (Optional Scoping)

By default, all authorized users can query all agents and integrations. Access groups are opt-in complexity for enterprises that need scoping (e.g., desktop team only sees Citrix agents, infra team sees everything).

- If a user has NO access group assignments → they see everything (default open)
- If a user has access group assignments → they only see agents matching the group's glob patterns and assigned integrations
- Access group filtering happens at the data layer (MCP tool results), not middleware

### Encryption

- `SONDE_SECRET` env var is the root of trust for all encryption (AES-256-GCM)
- All encryption uses `packages/hub/src/integrations/crypto.ts` — do NOT create a second crypto module
- `SONDE_API_KEY` is deprecated but accepted as fallback for backward compatibility
- API keys are stored in the database, not env vars. No hardcoded master key.

### SSO Config vs Integrations

- SSO configuration (Entra tenant, client_id, client_secret) is stored in the `sso_config` table
- Integration configurations (ServiceNow, Citrix, etc.) are stored in the `integrations` table
- These are completely different concerns: identity provider vs data source. Do NOT mix them.

### Entra App Registration (Shared)

Phase 8a creates an Entra app registration with delegated permissions (authorization code flow): `openid profile email User.Read GroupMember.Read.All`. Phase 9a will add application permissions (client_credentials flow): `User.Read.All Group.Read.All AuditLog.Read.All DeviceManagementManagedDevices.Read.All` etc. Same client_id/client_secret, different grant types. Design the app registration knowing it will be extended.

### Integration Packs (Read-Only)

All integration packs (ServiceNow, Citrix, Entra/Intune, vCenter, observability, ITSM) are strictly read-only and diagnostic. They use least-privileged service accounts with read-only roles. They do NOT create, modify, or delete anything in the target systems.

## Reference Docs

Detailed specs live in `/docs/` — read these when working on specific areas:

- `docs/ARCHITECTURE.md` — Full architecture, communication flow, security model (9 layers)
- `docs/PROTOCOL.md` — WebSocket message envelope, probe request/response, pack manifest Zod schemas
- `docs/PHASES.md` — Full phased build plan (Phase 0-6) with deliverables per phase
- `docs/CICD.md` — GitHub Actions workflows, release process, update flows (hub/agent/pack)
- `docs/DEPLOYMENT.md` — Hub deployment paths, agent install, TUI mockups, UX design
- `docs/SECURITY.md` — All 9 security layers, agent privilege model, mTLS, attestation

## Project Structure

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
│   ├── hub.Dockerfile             # Multi-stage: builds hub + dashboard
│   └── docker-compose.yml
├── docs/                          # Detailed reference docs
├── packages/
│   ├── shared/src/
│   │   ├── schemas/               # protocol.ts, probes.ts, packs.ts, mcp.ts
│   │   ├── types/                 # common.ts, agent.ts, hub.ts, integrations.ts
│   │   ├── crypto/                # signing.ts (RSA-SHA256)
│   │   └── index.ts
│   ├── hub/src/
│   │   ├── index.ts               # Entry: Hono + WS + static serving
│   │   ├── auth/                  # sessions.ts, session-middleware.ts, local-auth.ts, entra.ts
│   │   ├── mcp/server.ts          # MCP StreamableHTTP via SDK
│   │   ├── mcp/tools/             # probe.ts, list-agents.ts, diagnose.ts, agent-overview.ts
│   │   ├── mcp/auth.ts            # API key + OAuth validation
│   │   ├── ws/server.ts           # WebSocket for agents (mTLS)
│   │   ├── ws/dispatcher.ts       # Route probes to agents
│   │   ├── db/index.ts            # SQLite: agents, audit, api_keys, oauth, setup, sessions, sso_config
│   │   ├── integrations/          # executor.ts, manager.ts, probe-router.ts, crypto.ts
│   │   ├── crypto/                # ca.ts, mtls.ts
│   │   ├── engine/                # runbooks.ts, policy.ts
│   │   ├── oauth/                 # provider.ts
│   │   └── config.ts
│   ├── agent/src/
│   │   ├── index.ts               # CLI entry (enroll, start, status, packs, install)
│   │   ├── version.ts             # Dynamic version from package.json
│   │   ├── runtime/               # connection.ts, executor.ts, scrubber.ts, attestation.ts, privilege.ts, audit.ts
│   │   ├── tui/                   # installer/ (InstallerApp, StepHub, etc.), manager/ (ManagerApp)
│   │   ├── system/                # scanner.ts
│   │   ├── cli/                   # packs.ts
│   │   └── config.ts
│   ├── packs/src/
│   │   ├── types.ts               # Pack interface
│   │   ├── index.ts               # Pack registry
│   │   ├── system/                # disk-usage, memory-usage, cpu-usage
│   │   ├── docker/                # containers-list, images-list, logs-tail, daemon-info
│   │   ├── systemd/               # services-list, service-status, journal-query
│   │   └── integrations/          # httpbin.ts (server-side integration packs)
│   └── dashboard/
│       ├── index.html             # Vite SPA entry
│       ├── vite.config.ts         # React plugin, dev proxy
│       ├── postcss.config.mjs     # Tailwind v4 via PostCSS
│       └── src/
│           ├── main.tsx           # React root
│           ├── App.tsx            # Router: setup wizard vs app shell
│           ├── index.css          # Tailwind v4 import
│           ├── lib/api.ts         # Fetch wrapper
│           ├── hooks/             # useSetupStatus.ts, useAuth.tsx
│           ├── pages/             # Login, Fleet, AgentDetail, Integrations, etc.
│           └── components/
│               ├── layout/        # AppShell, Sidebar, TopBar
│               ├── setup/         # SetupWizard + 5 step components
│               └── dashboard/     # Overview
```

## File Conventions

- Probe functions: take params object, return structured data (not raw stdout)
- Schemas: all Zod, exported from @sonde/shared
- Tests: co-located (`*.test.ts` next to source), use Vitest
- Config: env vars for runtime, Zod-validated
- Logging: pino, structured JSON

## Implementation Notes

- **MCP transport**: Using `StreamableHTTPServerTransport` + `McpServer.registerTool()` from MCP SDK (not deprecated SSE/`.tool()` APIs)
- **Hub routing**: Raw Node HTTP server routes `/mcp` → MCP handler, OAuth paths → Express sub-app, rest → Hono via `getRequestListener`. Per-session McpServer instances.
- **Probe testability**: ExecFn injection — probe handlers accept `(params, exec)` where `exec` is `(cmd, args) => Promise<string>`. Tests mock `exec`.
- **Dispatcher**: Supports concurrent probes per agent via `requestId` correlation (`Map<requestId, PendingRequest>`). Old agents without `requestId` fall back to first-match by agentId. Stale socket cleanup in `registerAgent` prevents delayed `close` events from evicting live reconnections.
- **Auth (dashboard)**: Session-based. `SessionManager` creates sessions (crypto.randomBytes(32) hex), stores in SQLite `sessions` table with 8hr sliding window expiry. Cookie `sonde_session` (httpOnly, secure, sameSite=Lax). Session middleware runs on `/api/*` and `/auth/*`, attaches `UserContext` to Hono context. API key middleware runs after on `/api/v1/*` as fallback. Public paths (`/api/v1/setup/status`, `/api/v1/setup/complete`, `/api/v1/agents`, `/api/v1/packs`) bypass auth. Local admin login validates against `SONDE_ADMIN_USER`/`SONDE_ADMIN_PASSWORD` env vars. Hono app typed with `Env = { Variables: { user: UserContext } }`.
- **Auth (Entra SSO)**: OIDC authorization code flow via `packages/hub/src/auth/entra.ts`. SSO config in `sso_config` table with encrypted client_secret (reuses `integrations/crypto.ts`). Callback extracts id_token claims (oid, name, email), performs dual authorization check against `authorized_users` and `authorized_groups` tables, creates session with highest resolved role.
- **Auth (MCP/WS)**: `extractApiKey()` checks Bearer header first, falls back to `?apiKey` query param. WS upgrade accepts master API key, scoped API keys (hash lookup), or enrollment tokens. OAuth 2.0 with PKCE for MCP clients.
- **Enrollment flow**: Tokens are one-time-use. Hub auto-detects enrollment tokens from bearer auth (supports both CLI `--token` and TUI). On token enrollment, hub mints a scoped API key (`agent:<name>`) and returns it in the `hub.ack`. Agent saves it for persistent reconnect auth. Stable agent identity: same name → same UUID across re-enrollments.
- **Agent version**: Read dynamically from `package.json` via `import.meta.url` in `src/version.ts`. Used in CLI output, probe metadata, and registration messages. `sonde --version` flag supported.
- **Dashboard**: Tailwind v4 via `@tailwindcss/postcss` (not `@tailwindcss/vite`) due to monorepo Vite version conflict (root has v5 from vitest, dashboard needs v6). Hub serves built dashboard assets with SPA fallback.
- **Setup flow**: First-boot wizard persisted in `setup` table. `GET /api/v1/setup/status` is unauthenticated. `POST /api/v1/setup/complete` is one-time (409 on repeat).
- **Integrations**: Server-side integration packs (no agent required). `IntegrationExecutor` registers packs and executes probes with injected `fetchFn` (retry on 5xx, configurable timeout). `IntegrationManager` handles CRUD with AES-256-GCM encrypted credential storage in SQLite. `ProbeRouter` dispatches probes — prefixed probes (e.g. `httpbin.ip`) go to executor, others go to agent dispatcher. Pack catalog (`ReadonlyMap<string, IntegrationPack>`) passed to manager constructor to avoid bootstrapping bug where findPack searched empty executor.
- **Install script**: `GET /install` returns a bash bootstrapper that installs Node.js 22 + `@sonde/agent`, then runs `sonde install --hub <url>` for the TUI. Supports Linux (apt/dnf/yum) and macOS (brew).

## Deployment

- **Hub**: Deployed at `https://mcp.sondeapp.com` via Dokploy. Dockerfile at repo root (copied from `docker/hub.Dockerfile`).
- **Agent**: Installed on target machines via `npm install -g @sonde/agent` or `curl -fsSL https://mcp.sondeapp.com/install | bash`.
- **MCP integration**: Claude Desktop configured at `~/Library/Application Support/Claude/claude_desktop_config.json` with Sonde MCP server URL.
- **Live agent**: `gmtek01` enrolled and running on remote infrastructure.

## Publishing

- Changesets configured: `npx changeset` to create, `npm run release` to version + publish.
- `scripts/publish.sh` convenience wrapper: build → test → changeset version → changeset publish.
- Agent package (`@sonde/agent`) is public. Hub and dashboard are private.
