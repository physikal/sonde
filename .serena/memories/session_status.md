# Session Status — Last Updated 2026-02-19

## Current Phase
**Post-roadmap** — All planned phases (0 through 8a.2) are complete. Current work is ad-hoc: new features, UX polish, bug fixes, and additional integration packs as needed.

## Recently Completed Work

### Integration Wizard UX Polish (82e906b)
- Dynamic name placeholder in wizard Step 2 based on selected integration type (was hardcoded "production-datadog")
- Step headers 2-4 now show integration type label (e.g. "Datadog — Configuration")
- Added `NAME_PLACEHOLDERS` record in `Integrations.tsx`
- Added missing credential placeholders in `IntegrationDetail.tsx`: Check Point username, A10 username, ServiceNow OAuth clientSecret
- Fixed Cloudflare apiKey label to "Global API Key" in `IntegrationDetail.tsx` for consistency

### Previous Commits on dev (pre-session)
- `4547114` feat: add Check Point and A10 Networks integration packs
- `262cedb` feat: add ThousandEyes and Cisco Meraki integration packs
- `01df487` feat: auto-detect packs on enroll, background detach, stop/restart commands
- `fbff296` fix: persist pack install/uninstall state and harden install script
- `ffe09db` feat: add deterministic tag colors, tag management page, and settings nav

## Uncommitted / In-Progress Files
These are modified but NOT part of the latest commit (pre-existing working tree changes):
- `packages/agent/CHANGELOG.md`, `packages/agent/package.json`
- `packages/packs/CHANGELOG.md`, `packages/packs/package.json`
- `packages/packs/src/integrations/httpbin.ts`
- `packages/packs/src/system/index.ts`, `packages/packs/src/system/manifest.ts`
- `packages/shared/CHANGELOG.md`, `packages/shared/package.json`

Untracked new probe files (system pack):
- `packages/packs/src/system/probes/logs-dmesg.{ts,test.ts}`
- `packages/packs/src/system/probes/logs-journal.{ts,test.ts}`
- `packages/packs/src/system/probes/logs-tail.{ts,test.ts}`
- `packages/packs/src/system/probes/traceroute.{ts,test.ts}`

## Key Files for Current Work
- `packages/dashboard/src/pages/Integrations.tsx` — Integration list + creation wizard
- `packages/dashboard/src/pages/IntegrationDetail.tsx` — Single integration view/edit
- `packages/hub/src/auth/` — Auth system (sessions, SSO, local)
- `packages/hub/src/db/index.ts` — SQLite schema (agents, audit, api_keys, sessions, sso_config, authorized_users, authorized_groups)

## What's Next
No specific roadmap phase. Pick up ad-hoc feature requests, UX polish, bug fixes, and new integration packs as they come in.

## Important Notes
- ProtonDrive cloud storage path: files are at `/Users/joshowen/Library/CloudStorage/ProtonDrive-joshowen@protonmail.com-folder/AI/ClaudeCode/sonde`
- Edit tool sometimes silently fails on this path (filesystem sync). Always verify with `git diff` after edits.
- Build command: `npx turbo run build` (or `--filter=@sonde/dashboard` for dashboard only)
- Dashboard is NOT imported by other packages — it builds independently
