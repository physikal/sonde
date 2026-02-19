# Current Status

**Branch:** `dev`
**Last session:** 2026-02-17

## Completed

- [x] Phase 7 — Integration framework + httpbin pack + end-to-end tests
- [x] Phase 8a — Session-based auth (local login, session middleware, dashboard auth guard)
- [x] ApiKeyGate removal — all 7 dashboard pages use `apiFetch()` with session cookie, deleted `ApiKeyGate.tsx` + `useApiKey.ts`
- [x] Login bug fixes — falsy password check, post-login SPA redirect (`window.location.href`)
- [x] Docs site — Astro + Starlight (`@sonde/docs`)
- [x] CLAUDE.md updated with phase 8a completion
- [x] Phase 8b.1 — Entra ID SSO integration

### Phase 8b.1 Details
- [x] Migration 005: `sso_config` + `authorized_users` tables
- [x] DB methods: SSO config CRUD, authorized users CRUD
- [x] Entra OIDC auth flow: `/auth/entra/login` (redirect), `/auth/entra/callback` (token exchange + session)
- [x] REST endpoints: SSO config (`/api/v1/sso/*`), authorized users (`/api/v1/authorized-users/*`)
- [x] Dashboard Login page: SSO button with Microsoft logo, error handling for SSO redirects
- [x] Dashboard Settings page: SSO configuration form + authorized users management table
- [x] Unit tests: 8 tests for Entra auth (login redirect, callback flows, error cases)
- [x] All 173 tests passing, build clean, biome clean

## Up Next — Phase 8b.2: RBAC

### 8b.2 — Role-Based Access Control (RBAC)
- [ ] Activate `minimumRole` filtering on Sidebar items (already wired)
- [ ] Enforce roles on API endpoints (admin-only: API Keys, Policies, Enrollment)
- [ ] Role assignment from Entra ID groups or local config

### Other Backlog
- [ ] Deploy updated hub to Dokploy (includes session auth + integration framework + SSO)
- [ ] Test live with gmtek01 agent after deploy
- [ ] Playwright e2e tests for login flow
- [ ] Update CLAUDE.md with phase 8b.1 completion
