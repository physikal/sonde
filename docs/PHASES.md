# Sonde Build Phases

## Phase 0: MVP (Week 1-2)

End-to-end proof of concept.

**Deliverables:**
- `@sonde/shared`: Base protocol Zod schemas (message envelope, probe request/response)
- `@sonde/hub`: Hono server, MCP SSE with `probe` tool, WebSocket server, SQLite, API key auth
- `@sonde/agent`: WebSocket client, CLI (enroll + status + start), system probe executor
- `@sonde/packs`: System pack (disk, memory, CPU)
- `docker-compose.yml` for local hub
- README with setup instructions

## Phase 1: Core Pack System (Week 3-4)

**Deliverables:**
- Pack manifest schema + validation
- Pack loader on agent (load from filesystem)
- Docker pack (containers.list, logs.tail, images.list, daemon.info)
- systemd pack (services.list, service.status, journal.query)
- `diagnose` MCP tool + runbook engine on hub
- `list_agents` and `agent_overview` MCP tools
- Agent software scanner (detect installed software, suggest packs)
- `sonde packs install/uninstall/list/scan` CLI commands
- Pack permission manifest + approval flow (CLI-based)

## Phase 2: Auth Hardening (Week 5-6)

**Deliverables:**
- mTLS: hub CA, cert generation during enrollment, mutual verification
- Single-use, time-limited enrollment tokens
- Payload signing on all messages
- Output sanitization pipeline (scrubber with default regex + custom patterns)
- Agent attestation (fingerprint on enrollment, verify on reconnect)
- OAuth 2.0 flow on hub for Claude.ai connector
- Per-API-key policy scoping
- Audit log with hash chain integrity
- Dedicated `sonde` system user + group-based permissions

## Phase 3: Agent TUI (Week 7-8)

**Deliverables:**
- Ink-based installer TUI (system scan, pack selection, permission approval, enrollment)
- Ink-based management TUI (main screen, pack manager, activity log, audit viewer)
- Keyboard navigation, real-time updates
- `sonde` launches TUI, `sonde --headless` for non-interactive

## Phase 4: Hub Dashboard (Week 9-11)

**Deliverables:**
- React/Vite/Tailwind dashboard
- First-boot setup wizard
- Fleet overview (agent list, status, packs)
- Agent detail view (probes, history, audit)
- Enrollment page (generate token, live agent appear)
- API key management, policy editor, audit log viewer
- "Try it" dry-run panel
- Real-time WebSocket updates to browser

## Phase 5: Hub Installer + Deployment (Week 12-13)

**Deliverables:**
- Hub one-liner installer script (TUI: dependency check, Docker install, domain/TLS config)
- Cloudflare Tunnel integration
- Let's Encrypt auto-configuration (Caddy or Traefik)
- Tailscale/local-only mode
- Dokploy-ready compose with Traefik labels
- Hub offers to install agent on same box during setup

## Phase 6: Launch Prep (Week 14-16)

**Deliverables:**
- Signed pack system (code signing in CI, agent verification)
- Pack registry / marketplace (basic curated list)
- `sonde update` self-update mechanism
- Database migration system
- Documentation site (Starlight or Docusaurus)
- Landing page
- stdio MCP bridge for Claude Code
- Additional packs: nginx, Postgres, Redis, MySQL

## Future Phases (post-launch)
- Syslog ingestion on hub
- External platform packs (Splunk, Elasticsearch, Loki, Datadog)
- GUI installer (Electron or Tauri)
- Windows agent support
- OpenClaw integration
- Community pack submissions + review
- Hub HA / clustering
- Cloud marketplace images
- Hosted SaaS offering
