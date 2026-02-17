# Phase 7: Integration Pack Framework + httpbin End-to-End Proof

## Part 1: Encrypted Credential Storage (complete)

- [x] Step 1: Encryption module — `packages/hub/src/integrations/crypto.ts`
- [x] Step 2: Migration 003 — integrations table
- [x] Step 3: DB CRUD methods
- [x] Step 4: IntegrationManager class
- [x] Step 5: REST API endpoints — 6 endpoints under `/api/v1/integrations`
- [x] Step 6: Startup wiring
- [x] Step 7: `unregisterPack()` method on IntegrationExecutor
- [x] Step 8: Tests — crypto + manager + migrator

## Part 2: httpbin Integration Pack + End-to-End Proof (complete)

- [x] Step 1: Move integration types to `@sonde/shared` — created `types/integrations.ts`, hub re-exports
- [x] Step 2: Create httpbin integration pack — `packages/packs/src/integrations/httpbin.ts` (ip/headers/status probes + runbook)
- [x] Step 3: Fix IntegrationManager `findPack()` bug — added `packCatalog` constructor param, replaced executor lookup
- [x] Step 4: httpbin integration test — 7 tests (probe execution, testConnection, ProbeRouter routing)
- [x] Step 5: Mixed routing test — 2 tests (agent+integration mixed routing, RunbookEngine integration)
- [x] Step 6: Lint fixes — import ordering, formatting, biome-ignore for test assertions

## Verification

- [x] `npm run build` — all 6 packages compile
- [x] `npm run test` — 140 hub tests (21 files), 85 packs, 81 agent, 11 shared — all pass
- [x] `npm run lint` — no new lint errors in changed files

## Files Created
- `packages/shared/src/types/integrations.ts` — integration type definitions (moved from hub)
- `packages/packs/src/integrations/httpbin.ts` — httpbin integration pack
- `packages/hub/src/integrations/httpbin.test.ts` — 7 tests
- `packages/hub/src/integrations/mixed-routing.test.ts` — 2 tests

## Files Modified
- `packages/shared/src/index.ts` — export integration types
- `packages/hub/src/integrations/types.ts` — re-export from shared (was definitions)
- `packages/packs/src/index.ts` — export httpbinPack
- `packages/hub/src/integrations/manager.ts` — added packCatalog param, fixed findPack()
- `packages/hub/src/integrations/manager.test.ts` — updated for catalog constructor
- `packages/hub/src/index.ts` — build integration catalog, pass to manager, import httpbinPack
