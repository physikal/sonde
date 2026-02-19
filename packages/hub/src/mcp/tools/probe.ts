import type { SondeDb } from '../../db/index.js';
import type { AuthContext } from '../../engine/policy.js';
import { evaluateProbeAccess } from '../../engine/policy.js';
import type { ProbeRouter } from '../../integrations/probe-router.js';

export async function handleProbe(
  args: { agent?: string; probe: string; params?: Record<string, unknown> },
  probeRouter: ProbeRouter,
  db: SondeDb,
  auth?: AuthContext,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}> {
  try {
    const agentOrSource = args.agent ?? args.probe.split('.')[0]!;

    // Policy check
    if (auth) {
      const decision = evaluateProbeAccess(auth, agentOrSource, args.probe);
      if (!decision.allowed) {
        return {
          content: [{ type: 'text', text: `Access denied: ${decision.reason}` }],
          isError: true,
        };
      }
    }

    const caller = auth?.keyId ? { apiKeyId: auth.keyId } : undefined;
    const response = await probeRouter.execute(args.probe, args.params, args.agent, caller);

    db.logAudit({
      apiKeyId: auth?.keyId,
      agentId: agentOrSource,
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
    let hint = '';
    if (message.includes('not found or offline')) {
      const agentRow = args.agent ? db.getAgent(args.agent) : undefined;
      if (agentRow) {
        const lastSeen = agentRow.lastSeen
          ? ` Last seen: ${agentRow.lastSeen}.`
          : '';
        hint = ` Agent "${args.agent}" is registered but offline.${lastSeen} Check that the agent process is running and can reach the hub.`;
      } else {
        hint = ' Check that the agent is running and connected to the hub.';
      }
    } else if (message.includes('timed out')) {
      hint = ' The agent may be overloaded or the probe may be slow.';
    }
    return {
      content: [{ type: 'text', text: `Error: ${message}${hint}` }],
      isError: true,
    };
  }
}
