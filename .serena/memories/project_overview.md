# Sonde — AI Infrastructure Agent

## Purpose
Hub-and-spoke MCP agent system for AI-driven infrastructure diagnostics. Engineers connect AI assistants to Sonde via MCP to diagnose infrastructure issues.

## Tech Stack
- TypeScript, Node.js 22 LTS
- Monorepo: npm workspaces + Turborepo
- Hub: Hono + ws + better-sqlite3
- Agent: ws client, Ink v5 TUI
- Dashboard: React 19 + Vite 6 + Tailwind v4
- Testing: Vitest + Playwright
- Linting: Biome
- Schemas: Zod

## Packages
- `@sonde/shared` — Protocol schemas, types, crypto
- `@sonde/packs` — Pack definitions (system, docker, systemd)
- `@sonde/hub` — MCP server, WebSocket server, REST API, dashboard serving
- `@sonde/agent` — WebSocket client, CLI, TUI
- `@sonde/dashboard` — React SPA
- `@sonde/docs` — Astro + Starlight docs

## Code Style
- Biome for linting and formatting
- 2-space indent, single quotes, semicolons
- 100 char line width
- Zod for all schemas
- Co-located tests (*.test.ts)
- pino for logging
