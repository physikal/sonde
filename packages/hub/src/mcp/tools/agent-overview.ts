import type { SondeDb } from '../../db/index.js';
import type { AuthContext } from '../../engine/policy.js';
import { evaluateAgentAccess } from '../../engine/policy.js';
import type { AgentDispatcher } from '../../ws/dispatcher.js';

export function handleAgentOverview(
  args: { agent: string },
  db: SondeDb,
  dispatcher: AgentDispatcher,
  auth?: AuthContext,
): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
} {
  // Policy check
  if (auth) {
    const decision = evaluateAgentAccess(auth, args.agent);
    if (!decision.allowed) {
      return {
        content: [{ type: 'text', text: `Access denied: ${decision.reason}` }],
        isError: true,
      };
    }
  }

  const agent = db.getAgent(args.agent);
  if (!agent) {
    return {
      content: [{ type: 'text', text: `Error: Agent "${args.agent}" not found` }],
      isError: true,
    };
  }

  const isOnline = dispatcher.isAgentOnline(agent.id) || dispatcher.isAgentOnline(agent.name);

  const result = {
    id: agent.id,
    name: agent.name,
    status: isOnline ? 'online' : agent.status,
    lastSeen: agent.lastSeen,
    os: agent.os,
    agentVersion: agent.agentVersion,
    packs: agent.packs,
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
