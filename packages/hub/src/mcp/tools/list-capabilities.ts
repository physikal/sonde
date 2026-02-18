import type { Pack } from '@sonde/packs';
import type { SondeDb } from '../../db/index.js';
import type { AuthContext } from '../../engine/policy.js';
import { evaluateAgentAccess } from '../../engine/policy.js';
import type { RunbookEngine } from '../../engine/runbooks.js';
import type { IntegrationManager } from '../../integrations/manager.js';
import type { AgentDispatcher } from '../../ws/dispatcher.js';

interface AgentCapability {
  name: string;
  id: string;
  status: 'online' | 'offline' | 'degraded';
  lastSeen: string;
  packs: Array<{ name: string; version: string }>;
  runbookCategories: string[];
}

interface IntegrationCapability {
  name: string;
  type: string;
  status: string;
  diagnosticCategories: string[];
}

interface RunbookCategoryInfo {
  category: string;
  type: 'simple' | 'diagnostic';
  description?: string;
  params?: Record<
    string,
    { type: string; description: string; required?: boolean }
  >;
}

interface CapabilitiesResult {
  agents: AgentCapability[];
  integrations: IntegrationCapability[];
  runbookCategories: RunbookCategoryInfo[];
}

export function handleListCapabilities(
  db: SondeDb,
  dispatcher: AgentDispatcher,
  runbookEngine: RunbookEngine,
  integrationManager: IntegrationManager,
  packRegistry: ReadonlyMap<string, Pack>,
  auth?: AuthContext,
): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
} {
  const onlineIds = new Set(dispatcher.getOnlineAgentIds());
  const allAgents = db.getAllAgents();

  // Build pack name → runbook category mapping from agent packs
  const packToCategory = new Map<string, string>();
  for (const [name, pack] of packRegistry) {
    if (pack.manifest.runbook) {
      packToCategory.set(name, pack.manifest.runbook.category);
    }
  }

  const agents: AgentCapability[] = allAgents
    .filter((agent) => {
      if (!auth) return true;
      return (
        evaluateAgentAccess(auth, agent.name).allowed ||
        evaluateAgentAccess(auth, agent.id).allowed
      );
    })
    .map((agent) => {
      const matchingCategories: string[] = [];
      for (const pack of agent.packs) {
        const category = packToCategory.get(pack.name);
        if (category) {
          matchingCategories.push(category);
        }
      }

      return {
        name: agent.name,
        id: agent.id,
        status: onlineIds.has(agent.id)
          ? ('online' as const)
          : agent.status === 'degraded'
            ? ('degraded' as const)
            : ('offline' as const),
        lastSeen: agent.lastSeen,
        packs: agent.packs.map((p) => ({
          name: p.name,
          version: p.version,
        })),
        runbookCategories: matchingCategories,
      };
    });

  // Build integration type → diagnostic categories mapping
  const activeIntegrations = integrationManager.list();
  const allCategories = runbookEngine.getCategories();

  const integrations: IntegrationCapability[] = activeIntegrations.map(
    (integration) => {
      const matchingCategories = allCategories.filter((cat) => {
        const diagnosticRunbook =
          runbookEngine.getDiagnosticRunbook(cat);
        if (!diagnosticRunbook) return false;
        return cat.startsWith(integration.type + '-') ||
          cat === integration.type;
      });

      return {
        name: integration.name,
        type: integration.type,
        status: integration.status,
        diagnosticCategories: matchingCategories,
      };
    },
  );

  // Collect all runbook category metadata
  const runbookCategories: RunbookCategoryInfo[] = [];

  for (const category of allCategories) {
    const diagnosticRunbook =
      runbookEngine.getDiagnosticRunbook(category);
    if (diagnosticRunbook) {
      runbookCategories.push({
        category,
        type: 'diagnostic',
        description: diagnosticRunbook.description,
        params: diagnosticRunbook.params,
      });
      continue;
    }

    const simpleRunbook = runbookEngine.getRunbook(category);
    if (simpleRunbook) {
      runbookCategories.push({
        category,
        type: 'simple',
        description: simpleRunbook.definition.category,
      });
    }
  }

  const result: CapabilitiesResult = {
    agents,
    integrations,
    runbookCategories,
  };

  return {
    content: [
      { type: 'text', text: JSON.stringify(result, null, 2) },
    ],
  };
}
