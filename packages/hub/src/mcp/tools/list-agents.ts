import type { SondeDb } from '../../db/index.js';
import type { AuthContext } from '../../engine/policy.js';
import { evaluateAgentAccess } from '../../engine/policy.js';
import type { AgentDispatcher } from '../../ws/dispatcher.js';

export function handleListAgents(
  db: SondeDb,
  dispatcher: AgentDispatcher,
  auth?: AuthContext,
  filterTags?: string[],
): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
} {
  const agents = db.getAllAgents();
  const onlineIds = new Set(dispatcher.getOnlineAgentIds());
  const allTags = db.getAllAgentTags();

  let result = agents
    .filter((agent) => {
      if (!auth) return true;
      return (
        evaluateAgentAccess(auth, agent.name).allowed || evaluateAgentAccess(auth, agent.id).allowed
      );
    })
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: onlineIds.has(agent.id) ? 'online' : agent.status,
      lastSeen: agent.lastSeen,
      packs: agent.packs,
      os: agent.os,
      agentVersion: agent.agentVersion,
      tags: allTags.get(agent.id) ?? [],
    }));

  if (filterTags && filterTags.length > 0) {
    const normalized = filterTags.map((t) => t.replace(/^#/, ''));
    result = result.filter((agent) => normalized.every((t) => agent.tags.includes(t)));
  }

  return {
    content: [{ type: 'text', text: JSON.stringify({ agents: result }, null, 2) }],
  };
}
