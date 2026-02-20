import type { IntegrationPack } from '@sonde/shared';
import type { SondeDb } from '../db/index.js';
import type { IntegrationManager } from '../integrations/manager.js';
import type { ProbeRouter } from '../integrations/probe-router.js';

export const CORE_INSTRUCTIONS = `# Sonde Infrastructure Diagnostics

You are connected to a Sonde hub — an AI-powered infrastructure
diagnostic system. Sonde provides read-only diagnostic access to
remote machines (via agents) and enterprise systems (via integrations).

## MANDATORY First Step

You MUST call \`list_capabilities\` as your very first tool call in every
session, before calling any other Sonde tool. This is required because
available agents, integrations, and probe names change dynamically as
agents connect and disconnect. Without calling list_capabilities first,
you will not know the correct probe names and your calls will fail.

## Workflow

1. **FIRST**: Call \`list_capabilities\` to discover agents, integrations,
   and exact probe names. Do this before anything else.
2. Use \`health_check\` for broad "what's wrong?" questions — runs all
   applicable diagnostics in parallel.
3. Use \`diagnose\` to investigate a specific category after health_check
   flags an issue.
4. Use \`probe\` for a single targeted measurement when you already know
   the exact probe name from list_capabilities.
5. Use \`query_logs\` for root cause analysis after diagnostics reveal
   an issue.
6. Use \`list_agents\` for fleet status, \`agent_overview\` for one agent.

## Important Rules

- Never guess probe names. Always discover them via \`list_capabilities\`.
- Probe names are fully qualified: \`<pack>.<probe>\`, e.g.
  \`system.disk.usage\`, \`system.network.ping\`, \`docker.containers.list\`.
- Agent probes require the \`agent\` parameter. Integration probes do
  not — omit the agent parameter entirely.
- Only use the \`tags\` filter when the user explicitly writes #tagname
  syntax. Do not infer tags from natural language.`;

export function buildMcpInstructions(
  db: SondeDb,
  integrationManager: IntegrationManager,
  probeRouter: ProbeRouter,
): string {
  const parts: string[] = [];

  const customPrefix = db.getHubSetting('mcp_instructions_prefix');
  if (customPrefix?.trim()) {
    parts.push(customPrefix.trim());
  }

  parts.push(CORE_INSTRUCTIONS);

  const integrations = integrationManager.list();
  if (integrations.length > 0) {
    const packs = probeRouter.getIntegrationPacks();
    const packsByName = new Map<string, IntegrationPack>();
    for (const pack of packs) {
      packsByName.set(pack.manifest.name, pack);
    }

    const lines = integrations.map((i) => {
      const pack = packsByName.get(i.type);
      const desc = pack?.manifest.description ?? i.type;
      return `- ${i.name} (${i.type}): ${desc}`;
    });

    parts.push(`## Active Integrations\n\n${lines.join('\n')}`);
  }

  return parts.join('\n\n');
}
