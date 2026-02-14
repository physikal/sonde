import type { SondeDb } from '../../db/index.js';
import type { AgentDispatcher } from '../../ws/dispatcher.js';

export async function handleProbe(
  args: { agent: string; probe: string; params?: Record<string, unknown> },
  dispatcher: AgentDispatcher,
  db: SondeDb,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}> {
  try {
    const response = await dispatcher.sendProbe(args.agent, args.probe, args.params);

    db.logAudit({
      agentId: args.agent,
      probe: args.probe,
      status: response.status,
      durationMs: response.durationMs,
      requestJson: JSON.stringify(args),
      responseJson: JSON.stringify(response),
    });

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
