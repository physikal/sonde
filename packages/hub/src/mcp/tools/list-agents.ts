import type { SondeDb } from '../../db/index.js';
import type { AuthContext } from '../../engine/policy.js';
import { evaluateAgentAccess } from '../../engine/policy.js';
import type { AgentDispatcher } from '../../ws/dispatcher.js';

export function handleListAgents(
  db: SondeDb,
  dispatcher: AgentDispatcher,
  auth?: AuthContext,
): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
} {
  const agents = db.getAllAgents();
  const onlineIds = new Set(dispatcher.getOnlineAgentIds());

  const result = agents
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
    }));

  return {
    content: [{ type: 'text', text: JSON.stringify({ agents: result }, null, 2) }],
  };
}
