import type { IntegrationPack } from '@sonde/shared';
import type { SondeDb } from '../db/index.js';
import type { IntegrationManager } from '../integrations/manager.js';
import type { ProbeRouter } from '../integrations/probe-router.js';

export const CORE_INSTRUCTIONS = `# Sonde Infrastructure Diagnostics

You are connected to a Sonde hub — an AI-powered infrastructure
diagnostic system. Sonde provides read-only diagnostic access to
remote machines (via agents) and enterprise systems (via integrations).

## Workflow

Start with the broadest applicable tool and drill down:

1. \`health_check\` — Start here. Broad "what's wrong?" or "how is X
   doing?" questions. Runs all applicable diagnostics in parallel.
   Accepts agent name, tags, or no args (checks everything).
2. \`diagnose\` — Investigate a specific category (e.g. "check docker on
   server-1"). Use after health_check flags an issue, or directly when
   the user asks about a known category.
3. \`list_capabilities\` — Discover exact probe names for targeted
   follow-up. Call this when you need a specific probe name for the
   \`probe\` tool. No probes executed — metadata only.
4. \`probe\` — Single targeted measurement using an exact probe name
   from list_capabilities (e.g. \`system.disk-usage\`).
5. \`query_logs\` — Root cause analysis via logs after diagnostics
   reveal an issue.
6. \`check_critical_path\` — Execute a predefined infrastructure chain.
   Call list_capabilities to discover available path names.
7. \`list_agents\` — Fleet roster with status and tags.
   \`agent_overview\` — Deep detail on one agent.

## Important Rules

- Never guess probe names. Discover them via \`list_capabilities\`.
- Probe names are fully qualified: \`<pack>.<probe>\`, e.g.
  \`system.disk-usage\`, \`system.network.ping\`, \`docker.containers-list\`.
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
