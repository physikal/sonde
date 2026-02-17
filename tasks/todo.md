# Phase 6: Launch Prep

## Implementation

- [x] **Database migration system**
  - [x] `packages/hub/src/db/migrations/001-initial-schema.ts` — captures full existing schema
  - [x] `packages/hub/src/db/migrations/002-hub-settings.ts` — new hub_settings table
  - [x] `packages/hub/src/db/migrations/index.ts` — sorted migrations array
  - [x] `packages/hub/src/db/migrator.ts` — `runMigrations()` with per-migration transactions
  - [x] `packages/hub/src/db/migrator.test.ts` — in-memory SQLite tests (fresh, idempotent, incremental)
  - [x] `packages/hub/src/db/index.ts` — replaced `migrate()` with `runMigrations()`, added `getHubSetting()`/`setHubSetting()`

- [x] **Signed pack system**
  - [x] `packages/shared/src/crypto/pack-signing.ts` — `signPackManifest()`, `verifyPackManifest()`, `PACK_SIGNING_PUBLIC_KEY`
  - [x] `packages/shared/src/crypto/pack-signing.test.ts` — sign/verify/tamper/missing tests
  - [x] `packages/shared/src/index.ts` — exported pack signing functions
  - [x] `packages/packs/src/signatures.ts` — generated signatures map (starts empty)
  - [x] `packages/packs/src/validation.ts` — `createPackRegistry()` gains `PackRegistryOptions` with `allowUnsignedPacks`
  - [x] `packages/packs/src/index.ts` — injects signatures, passes options
  - [x] `packages/agent/src/config.ts` — added `allowUnsignedPacks` to `AgentConfig`
  - [x] `packages/agent/src/runtime/executor.ts` — added `ProbeExecutorOptions`, exported `PackRegistryOptions`
  - [x] `scripts/generate-pack-keypair.ts` — one-time RSA 4096-bit keypair generator
  - [x] `scripts/sign-packs.ts` — signs all pack manifests, writes signatures.ts

- [x] **Hub upgrade notifications**
  - [x] `packages/shared/src/types/common.ts` — added `hub.update_available` to `MessageType` enum
  - [x] `packages/hub/src/version-check.ts` — `checkLatestAgentVersion()`, `startVersionCheckLoop()`, `semverLt()`
  - [x] `packages/hub/src/version-check.test.ts` — npm registry mock tests, semver comparison
  - [x] `packages/hub/src/ws/server.ts` — sends `hub.update_available` to outdated agents, version-aware attestation
  - [x] `packages/hub/src/index.ts` — starts version check loop, added `/api/v1/agents/outdated` endpoint
  - [x] `packages/agent/src/runtime/connection.ts` — handles `hub.update_available`, added `onUpdateAvailable` event
  - [x] `packages/agent/src/index.ts` — logs update available message in `cmdStart()`
  - [x] `packages/dashboard/src/pages/Fleet.tsx` — amber "update available" badge in version column
  - [x] `packages/dashboard/src/pages/AgentDetail.tsx` — update available banner

- [x] **Agent self-update**
  - [x] `packages/agent/src/cli/update.ts` — `checkForUpdate()`, `performUpdate()`, `semverLt()`
  - [x] `packages/agent/src/cli/update.test.ts` — npm registry mock, semver, error handling tests
  - [x] `packages/agent/src/index.ts` — `sonde update` command, added to usage

- [x] **Build and test**
  - [x] `scripts/publish.sh` — added pack signing step before publish
  - [x] `npm run build` — all 5 packages pass
  - [x] `npm run test` — all tests pass (221 tests across 37 test files)
  - [x] `npm run typecheck` — 4/4 core packages pass (dashboard has pre-existing error)

## Verification

| Check | Status |
|-------|--------|
| `npm run build` | Pass (5/5 packages) |
| `npm run test` | Pass (221 tests) |
| `npm run typecheck` (shared/packs/hub/agent) | Pass |
| `npm run typecheck` (dashboard) | Pre-existing error in useWebSocket.ts |
| Migrator test: fresh DB | Pass — applies 2 migrations |
| Migrator test: idempotent | Pass — 0 migrations on re-run |
| Migrator test: incremental | Pass — applies only new migration 3 |
| Pack signing test: sign/verify | Pass |
| Pack signing test: tamper detection | Pass |
| Version check test: npm registry | Pass |
| Version check test: semverLt | Pass |
| Agent update test: checkForUpdate | Pass |

## Review

**Database migration system**: Replaced inline `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` in `SondeDb.migrate()` with versioned migration files. `runMigrations()` creates a `schema_version` table, applies pending migrations per-transaction, and logs each. Migration 001 captures the full existing schema (idempotent for existing DBs), migration 002 adds `hub_settings` table. `SondeDb` gains `getHubSetting()`/`setHubSetting()` for key-value storage.

**Signed pack system**: Uses existing `signPayload`/`verifyPayload` from `@sonde/shared`. Build-time signing script generates `signatures.ts` map. Pack registry injects signatures into manifests at import. `createPackRegistry()` gains `allowUnsignedPacks` option (default `true` for transition). Agent config supports `allowUnsignedPacks`. Keypair generation and signing are separate scripts for CI integration.

**Hub upgrade notifications**: Hub periodically polls npm registry for latest `@sonde/agent` version (every 6h), stores in `hub_settings`. On agent registration, compares versions and sends `hub.update_available` message. Agent connection handles the new message type and fires `onUpdateAvailable` event. Dashboard shows amber badge on Fleet page and banner on AgentDetail page. Attestation logic now accepts new baselines when agent version changes (expected after self-update).

**Agent self-update**: New `sonde update` command checks npm registry, compares versions, runs `npm install -g @sonde/agent@{version}`, verifies installed version, and attempts systemd service restart (best-effort). Clean error handling for network failures and version mismatches.
