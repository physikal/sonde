# Contributing to Sonde

Thanks for your interest in contributing to Sonde! This guide covers everything you need to get started.

## Getting Started

```bash
# Fork and clone the repo
git clone https://github.com/<your-username>/sonde.git
cd sonde

# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm run test

# Type-check and lint
npm run typecheck
npm run lint
```

Requires Node.js 22+ and npm 10+.

## Branch Strategy

- Branch from `dev`, not `main`
- PR back to `dev`
- `main` is the stable release branch — only merged from `dev` via release PRs
- Use `feature/<name>` for new features, `fix/<name>` for bug fixes

```bash
git checkout dev
git pull origin dev
git checkout -b feature/my-feature
```

## Code Style

- **Linter/Formatter:** [Biome](https://biomejs.dev/) — run `npm run lint` and `npm run format`
- **TypeScript:** Strict mode, no `any` unless absolutely necessary
- **Schemas:** All protocol types defined with [Zod](https://zod.dev/) in `@sonde/shared`
- **Tests:** Co-located next to source (`*.test.ts`), using [Vitest](https://vitest.dev/)
- **Imports:** Use `.js` extensions in TypeScript imports (Node.js ESM)

## Making Changes

1. Create a feature branch from `dev`
2. Make your changes
3. Add or update tests for any new behavior
4. Run the full check suite:
   ```bash
   npm run typecheck && npm run lint && npm run test && npm run build
   ```
5. Create a changeset (see below)
6. Open a PR to `dev`

## Changesets

We use [Changesets](https://github.com/changesets/changesets) for versioning and changelogs. Before committing, create a changeset describing your change:

```bash
npx changeset
```

This will prompt you to:
1. Select which packages are affected
2. Choose the semver bump type (patch, minor, major)
3. Write a summary of the change

The changeset file is committed with your PR.

## Pack Development

Packs are capability plugins that define probes an agent can execute. To create a new pack:

1. Create a directory under `packages/packs/src/<pack-name>/`
2. Define a manifest with pack metadata, detection rules, and probe definitions
3. Implement probe handlers that accept params and return structured data
4. Use the `ExecFn` injection pattern for testability — probes accept `(params, exec)` where `exec` runs local commands
5. Write tests with mocked `exec` output
6. Register the pack in `packages/packs/src/index.ts`

See the [Creating a Pack](https://sondeapp.com/packs/creating/) docs for a full walkthrough, or use any existing pack as a template.

## Commit Messages

Use conventional commit style:

- `feat:` new features
- `fix:` bug fixes
- `docs:` documentation changes
- `refactor:` code changes that don't fix bugs or add features
- `test:` adding or updating tests
- `chore:` tooling, CI, dependencies

## Monorepo Structure

```
packages/
  shared/    → Protocol schemas, types, crypto (no deps)
  packs/     → Pack definitions (depends on shared)
  hub/       → MCP server, WebSocket, DB (depends on shared, packs)
  agent/     → WebSocket client, CLI, TUI (depends on shared, packs)
  dashboard/ → React SPA (independent)
  docs/      → Documentation site (independent)
```

Build order is managed by Turborepo — `npm run build` handles it automatically.

## Questions?

Open an issue on [GitHub](https://github.com/physikal/sonde/issues) or start a discussion.
