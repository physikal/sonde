# Sonde CI/CD Pipeline

## Repository: GitHub (sonde-dev/sonde monorepo)

## Branch Strategy

- `main` — stable, always deployable, protected
- `dev` — integration branch, PRs merge here first
- `feature/*` — feature branches off dev
- `release/v*` — release branches cut from main
- `hotfix/*` — emergency fixes from main

## On Pull Request (ci.yml)

Trigger: PR to `dev` or `main`

```
1. npm ci
2. Turborepo pipeline:
   a. @sonde/shared     → typecheck → lint → test
   b. @sonde/packs      → typecheck → lint → test (depends on shared)
   c. @sonde/hub        → typecheck → lint → test (depends on shared, packs)
   d. @sonde/agent      → typecheck → lint → test (depends on shared, packs)
   e. @sonde/dashboard  → typecheck → lint → test → build
3. Integration tests: hub + agent in Docker Compose
4. Dashboard e2e (Playwright)
```

Turborepo caches — unchanged packages skip.

## On Merge to main (release.yml)

```
1. Full CI pipeline
2. Changesets version bump → "Version Packages" PR
3. Build:
   a. Hub Docker image → ghcr.io/sonde-dev/hub:latest + :sha + :v{version}
   b. Dashboard → bundled into hub image as static assets
4. Publish @sonde/* to npm
5. GitHub Release with auto-generated changelog
```

## Nightly (nightly.yml)

Cron 2am UTC from main:

```
1. Full CI + extended tests
2. ghcr.io/sonde-dev/hub:nightly
3. @sonde/agent@nightly on npm
```

## Release Channels

- **stable** — tagged releases (v1.0.0, v1.1.0)
- **beta** — pre-release (@sonde/agent@beta, hub:beta)
- **nightly** — daily from main

Agent config: `{ "updateChannel": "stable" }`

## Hub Update Flow

```
Code → PR → merge to main → Changesets version PR → merge
  → GitHub Actions builds Docker image → ghcr.io
  → Self-hosted:
    - Watchtower auto-pulls + restarts
    - OR Dokploy webhook redeploys
    - OR manual: docker compose pull && docker compose up -d
  → Hub runs pending migrations on start
  → Dashboard shows new version
  → Hub flags outdated agents
```

## Agent Update Flow

```
New version on npm
  → Hub compares agent version on WebSocket connect
  → If outdated: sends 'update_available' over WebSocket
  → Agent TUI shows badge, dashboard shows "outdated"
  → User: sonde update
    - Downloads from npm or GitHub Releases
    - Verifies checksum + signature
    - Replaces binary, restarts systemd service
    - Reconnects, hub re-attests
  → Optional auto-update:
    - Config: "autoUpdate": true
    - Daily check, download, verify, hot-swap
```

## Pack Update Flow

```
sonde packs update
  → Download new pack version
  → Verify signature
  → If new permissions needed: pending state, prompt approval
  → If no new permissions: hot-swap
  → Hub notified via heartbeat
  → Audit log entry
```

## Versioning

Managed by Changesets (https://github.com/changesets/changesets):
- Each PR includes a changeset file describing the change
- On merge to main, changesets bot creates "Version Packages" PR
- Merging that PR triggers publish workflow
- Changelog auto-generated from changeset descriptions
