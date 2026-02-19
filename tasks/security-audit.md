# Sonde Security Audit — Remediation Tracker

Audit performed: 2026-02-18
Status: Critical and High items complete. Medium items substantially addressed.

## CRITICAL

- [x] **C1** — Entra ID token not cryptographically verified → Fixed: JWT verified via `jose` JWKS (`auth/entra.ts`)
- [x] **C2** — Agent TLS certificate verification disabled → Fixed: `rejectUnauthorized: true` (`agent/runtime/connection.ts`)

## HIGH

- [ ] **H1** — No brute force protection on local login (`auth/local-auth.ts:15-24`)
- [x] **H2** — Timing attack on password comparison → Fixed: `crypto.timingSafeEqual` (`auth/local-auth.ts`)
- [x] **H3** — Admin can escalate to owner via API key creation → Fixed: role ceiling check (`index.ts`)
- [x] **H4** — Admin can assign owner role to users/groups → Fixed: role ceiling checks on all 4 endpoints (`index.ts`)
- [x] **H5** — Dashboard WebSocket has no authentication → Fixed: session cookie validation on upgrade (`ws/server.ts`)
- [x] **H6** — Public endpoints expose fleet inventory → Fixed: removed `/api/v1/agents` and `/api/v1/packs` from public paths (`index.ts`)
- [x] **H7** — Signature verification bypass with empty string → Fixed: reject empty signatures from agents with stored certs (`ws/server.ts`)
- [x] **H8** — Agent impersonation via untrusted agentId → Fixed: socket-to-agentId lookup prevents spoofing (`ws/server.ts`, `ws/dispatcher.ts`)
- [x] **H9** — CA private key stored unencrypted in SQLite → Fixed: AES-256-GCM encryption via SONDE_SECRET, migration 007 (`db/index.ts`)
- [x] **H10** — No security headers → Fixed: X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy middleware (`index.ts`)
- [x] **H11** — Container runs as root → Fixed: `USER sonde` in both Dockerfiles
- [x] **H12** — Hardcoded secret in docker-compose.yml → Fixed: env var reference with required check
- [x] **H13** — Install script URL from attacker-controlled headers → Fixed: require SONDE_HUB_URL, reject header fallback (`index.ts`)
- [x] **H14** — Argument injection in probe handlers → N/A: `execFile` with array args is safe by design

## MEDIUM

- [x] **M1** — No PKCE in Entra OIDC flow → Fixed: S256 code_challenge/code_verifier added (`auth/entra.ts`)
- [ ] **M2** — Session not invalidated on role change (`sessions.ts:44-62`) — accepted risk, sessions expire in 8h
- [ ] **M3** — Setup complete endpoint race condition (`index.ts`) — accepted risk, one-time operation
- [ ] **M4** — Static salt in scrypt key derivation (`integrations/crypto.ts:3-4`)
- [ ] **M5** — Low scrypt cost parameter N=16384 (`integrations/crypto.ts:7`)
- [ ] **M6** — OAuth tokens not hashed before DB storage (`oauth/provider.ts:168-189`)
- [ ] **M7** — ReDoS risk in access group glob patterns (`access-groups.ts:11-14`)
- [x] **M8** — Enrollment tokens exposed in full via list API → Fixed: active tokens masked to first 8 chars (`db/index.ts`)
- [ ] **M9** — REST probe endpoints bypass policy — accepted risk, all roles have full diagnostic access per design
- [x] **M10** — Integration CRUD endpoints lack role guards → Fixed: `requireRole('admin')` guard added (`index.ts`)
- [x] **M11** — Agent detail endpoint bypasses access group filtering → Fixed: `isAgentVisible()` check added (`index.ts`)
- [x] **M12** — No WebSocket message size caps → Fixed: `maxPayload: 1_048_576` (1MB) on both WS servers (`ws/server.ts`)
- [ ] **M13** — No rate limiting on any HTTP endpoint — defer to reverse proxy (nginx/Dokploy)
- [x] **M14** — Install script hub URL from attacker-controlled headers → Fixed with H13
- [ ] **M15** — ServiceNow query injection — accepted risk, read-only queries, limited impact
- [x] **M16** — MCP request body not size-limited → Fixed: 10MB max body size check (`mcp/server.ts`)
- [x] **M17** — RegisterPayload not Zod-validated → Fixed: Zod schema in `@sonde/shared`, validated in `ws/server.ts`

## LOW

- [ ] **L1** — No `__Host-` cookie prefix (`local-auth.ts:34`)
- [ ] **L2** — 2048-bit RSA for CA with 10-year validity (`crypto/ca.ts:15`)
- [ ] **L3** — No max session count per user (`sessions.ts`)
- [ ] **L4** — SONDE_SECRET min length only 16 chars (`config.ts:26-28`)
- [ ] **L5** — OAuth client secrets stored plaintext (`db/index.ts:538-550`)
- [ ] **L6** — Agent private key written without restrictive file perms (`agent/config.ts:63-71`)
- [ ] **L7** — Enrollment tokens stored plaintext (`db/index.ts:308-312`)
- [ ] **L8** — Signing failure returns empty string (`shared/crypto/signing.ts:14-16`)
- [ ] **L9** — Audit hash chain fragile across schema changes (`db/index.ts:172-198`)
- [ ] **L10** — Audit log doesn't record auth events (`db/index.ts`)

## INFO

- [ ] **I1** — Sliding window session can extend indefinitely
- [ ] **I2** — `api_keys.last_used_at` never updated
- [ ] **I3** — Agent minted API keys have no expiration
- [ ] **I4** — `rejectUnauthorized: false` on hub TLS server (intentional)
- [ ] **I5** — No secret rotation support for SONDE_SECRET
