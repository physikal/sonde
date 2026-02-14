import type { SondeDb } from '../../db/index.js';
import type { AuthContext } from '../../engine/policy.js';
import { evaluateProbeAccess } from '../../engine/policy.js';
import type { AgentDispatcher } from '../../ws/dispatcher.js';

export async function handleProbe(
  args: { agent: string; probe: string; params?: Record<string, unknown> },
  dispatcher: AgentDispatcher,
  db: SondeDb,
  auth?: AuthContext,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}> {
  try {
    // Policy check
    if (auth) {
      const decision = evaluateProbeAccess(auth, args.agent, args.probe, 'observe');
      if (!decision.allowed) {
        return {
          content: [{ type: 'text', text: `Access denied: ${decision.reason}` }],
          isError: true,
        };
      }
    }

    const response = await dispatcher.sendProbe(args.agent, args.probe, args.params);

    db.logAudit({
      apiKeyId: auth?.keyId,
      agentId: args.agent,
      probe: args.probe,
      status: response.status,
      durationMs: response.durationMs,
      requestJson: JSON.stringify(args),
      responseJson: JSON.stringify(response),
    });

    if (auth?.keyId && auth.keyId !== 'legacy') {
      db.updateApiKeyLastUsed(auth.keyId);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
}
