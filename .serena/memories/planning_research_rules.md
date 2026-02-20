# Planning & Research Rules

Lessons from the UniFi integration miss — apply these during every planning phase.

## 1. Verify external APIs against official docs
Before implementing any integration or external API call, fetch the vendor's actual developer documentation. Don't rely on blog posts, community wikis, or training data. APIs get replaced (e.g., UniFi's legacy session API was superseded by the official X-API-KEY integration API).

## 2. Trace the full feature path across the codebase
Before writing code, grep for an existing feature of the same kind and identify every file that touches it. In this monorepo, that means checking:
- Backend pack definition (`packages/packs/src/integrations/`)
- Pack index exports (`packages/packs/src/index.ts`)
- Hub catalog registration (`packages/hub/src/index.ts`)
- **Dashboard UI** — hardcoded type arrays in `Integrations.tsx` and `IntegrationDetail.tsx`
- Documentation (`packages/docs/`)

Missing the dashboard files meant the integration was invisible in the UI despite being correctly registered on the backend.

## 3. Validate auth UX end-to-end
If a credential form asks the user for fields that don't match the auth method they selected, something is wrong. Walk through the user flow mentally: what do they need to generate, what do they paste, does it make sense?
