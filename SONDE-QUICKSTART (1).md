# Sonde — Getting Started with Claude Code

## Prerequisites

- GitHub account with access to create repos/orgs
- Node.js 22 LTS installed locally
- Docker Desktop or Docker Engine running
- Claude Code installed (`npm install -g @anthropic-ai/claude-code`)

---

## Step 1: Create the GitHub Repo

```bash
# Create the org and repo on GitHub first (via github.com or gh cli)
gh repo create physikal/sonde --public --clone
cd sonde
git checkout -b dev
```

---

## Step 2: Bootstrap with Claude Code

Drop the CLAUDE.md into the repo root, then start Claude Code:

```bash
# Copy CLAUDE.md into the repo root
cp /path/to/CLAUDE.md ./CLAUDE.md

# Start Claude Code
claude
```

### Prompt 1: Scaffold the monorepo

```
Read CLAUDE.md thoroughly. Scaffold the Phase 0 MVP monorepo structure:

1. Initialize npm workspaces with packages: shared, hub, agent, packs, dashboard
2. Set up Turborepo (turbo.json) with build pipeline respecting package dependencies:
   shared → packs → hub + agent + dashboard
3. Create tsconfig.base.json with strict TS config, and per-package tsconfig.json extending it
4. Set up Biome for linting and formatting (biome.json at root)
5. Set up Vitest in each package (vitest.config.ts)
6. Create the root package.json with workspace scripts:
   - dev, build, lint, format, test, typecheck
7. Create a .gitignore covering node_modules, dist, .turbo, etc.
8. Do NOT write any application code yet — just the tooling skeleton.

After scaffolding, run `npm install` and `npm run build` to verify it works.
```

### Prompt 2: Shared package schemas

```
Now build @sonde/shared per CLAUDE.md Phase 0 scope:

1. Create the Zod schemas in src/schemas/:
   - protocol.ts (MessageEnvelope)
   - probes.ts (ProbeRequest, ProbeResponse)
   - packs.ts (PackManifest — full schema even though MVP only uses system pack)
   - mcp.ts (ProbeInput, ListAgentsOutput — MVP only needs ProbeInput)
2. Create types in src/types/:
   - common.ts (CapabilityLevel enum, AgentStatus enum, constants)
   - agent.ts (AgentInfo type)
   - hub.ts (HubConfig type)
3. Export everything from src/index.ts
4. Make sure it builds and types pass: npm run build --filter=@sonde/shared
```

### Prompt 3: System pack

```
Build the system pack in @sonde/packs per CLAUDE.md Phase 0:

1. Create the Pack interface/type in src/types.ts that all packs implement
2. Create src/system/:
   - manifest.json (PackManifest for system pack with 3 probes)
   - probes/disk-usage.ts (runs df, parses output, returns structured JSON)
   - probes/memory-usage.ts (runs free, parses output)
   - probes/cpu-usage.ts (reads /proc/stat or runs top, parses)
3. Create src/index.ts as pack registry
4. Each probe is a function that takes params and returns ProbeResponse.data
5. Write unit tests for each probe using mocked command output
6. Build and test: npm run build --filter=@sonde/packs && npm run test --filter=@sonde/packs
```

### Prompt 4: Hub MVP

```
Build @sonde/hub per CLAUDE.md Phase 0 MVP scope:

1. Hono HTTP server in src/index.ts that starts:
   a. MCP SSE endpoint at /mcp/sse using @modelcontextprotocol/sdk
   b. WebSocket server at /ws/agent using ws library
   c. Health check at /health
2. Single MCP tool: "probe" with ProbeInput schema
3. API key auth: read SONDE_API_KEY from env, validate on MCP connection and REST
4. WebSocket server:
   - Accept agent connections with API key in header
   - Track connected agents in memory (Map<agentId, WebSocket>)
   - Route probe requests to the right agent by name/id
   - Handle agent registration (agent.register message)
   - Handle heartbeats
5. SQLite database (better-sqlite3):
   - agents table (id, name, status, lastSeen, capabilities)
   - audit_log table (id, timestamp, apiKeyId, agentId, probe, status, durationMs)
   - Run migrations on startup
6. src/config.ts reads env vars: PORT, SONDE_API_KEY, SONDE_DB_PATH
7. Write unit tests for MCP tool handler and WebSocket dispatcher
8. Build and test: npm run build --filter=@sonde/hub && npm run test --filter=@sonde/hub
```

### Prompt 5: Agent MVP

```
Build @sonde/agent per CLAUDE.md Phase 0 MVP scope:

1. CLI entry point (src/index.ts) with two commands:
   - sonde enroll --hub <url> --key <apikey>
   - sonde status
2. Enroll command:
   - Saves hub URL and API key to ~/.sonde/config.json
   - Connects to hub WebSocket, sends agent.register message
   - Stores agent ID from hub.ack response
3. Agent runtime (src/runtime/connection.ts):
   - WebSocket client that connects to hub on startup
   - Sends heartbeats every 30 seconds
   - Receives probe.request messages, routes to pack executor
   - Reconnects with exponential backoff on disconnect
4. Probe executor (src/runtime/executor.ts):
   - Loads system pack from @sonde/packs
   - Maps probe names to probe functions
   - Executes, wraps result in ProbeResponse, sends back
5. Agent runs as foreground process for MVP (no systemd yet)
   - `sonde enroll` then `sonde start` to run
6. Write unit tests for executor and connection handling
7. Build and test: npm run build --filter=@sonde/agent && npm run test --filter=@sonde/agent
```

### Prompt 6: Docker + integration test

```
Create the Docker and integration test setup per CLAUDE.md:

1. docker/hub.Dockerfile:
   - node:22-alpine base
   - Copy built hub + shared + packs packages
   - Expose port 3000
   - CMD node packages/hub/dist/index.js

2. docker/docker-compose.yml:
   - sonde-hub service from hub.Dockerfile
   - Environment: SONDE_API_KEY=test-key-123, SONDE_DB_PATH=/data/sonde.db
   - Volume for /data
   - Port 3000:3000

3. Integration test (can live in a top-level test/ directory):
   - Spin up hub via docker-compose
   - Run agent enrollment against hub
   - Execute a probe request via MCP endpoint
   - Verify result comes back with disk usage data
   - Tear down

4. Verify the full loop works:
   docker compose -f docker/docker-compose.yml up -d
   # Then run agent locally against it
```

### Prompt 7: CI pipeline

```
Set up the GitHub Actions CI pipeline per CLAUDE.md:

1. .github/workflows/ci.yml:
   - Trigger: PR to dev or main
   - Steps:
     a. Checkout
     b. Setup Node 22
     c. npm ci
     d. npx turbo run typecheck lint test --filter=...
     e. Build all packages
     f. (Future: integration tests via docker compose — add as TODO comment)
   - Cache: node_modules + .turbo

2. .github/workflows/release.yml (scaffold only, don't fully implement yet):
   - Trigger: push to main (after merge)
   - TODO comments for: changesets version, docker build + push to ghcr.io, npm publish
   - Just scaffold the structure so we can fill it in during Phase 6

3. Branch protection rules reminder in a comment:
   - main: require PR, require CI pass, require 1 approval
   - dev: require CI pass

4. Create .github/CODEOWNERS:
   - * @your-github-username

5. Install changesets: npm install -D @changesets/cli @changesets/changelog-github
   - npx changeset init
```

---

## Step 3: First Commit + Push

After all prompts are done and everything builds:

```bash
# Verify everything works
npm install
npm run build
npm run test
npm run lint

# Commit to dev branch
git add -A
git commit -m "feat: Phase 0 MVP scaffold — monorepo, shared schemas, system pack, hub, agent, CI"
git push -u origin dev

# Create PR to main for initial setup
gh pr create --base main --head dev --title "Phase 0: MVP Foundation" --body "Initial monorepo scaffold with working end-to-end probe flow"
```

---

## Step 4: Verify End-to-End

```bash
# Terminal 1: Start hub
docker compose -f docker/docker-compose.yml up

# Terminal 2: Enroll + start agent
cd packages/agent
npx tsx src/index.ts enroll --hub http://localhost:3000 --key test-key-123
npx tsx src/index.ts start

# Terminal 3: Test MCP endpoint (curl simulating what Claude.ai would do)
# Or add the MCP URL to Claude.ai: http://localhost:3000/mcp/sse
# Then ask Claude: "What's the disk usage on my server?"
```

---

## What You Should Have After This

- Working monorepo with 5 packages, all building and testing
- Hub accepting MCP connections and routing probes to agents
- Agent connecting to hub and responding to system probes
- Docker Compose for local hub deployment
- GitHub Actions CI running on PRs
- Changesets initialized for versioning
- Ready to start Phase 1 (core pack system)

---

## Phase 1 Kickoff (next session)

```
Read CLAUDE.md Phase 1 deliverables. We're building the core pack system:
- Pack manifest validation + loader
- Docker pack and systemd pack
- diagnose MCP tool + runbook engine
- list_agents and agent_overview tools
- Software scanner + sonde packs CLI commands
```
