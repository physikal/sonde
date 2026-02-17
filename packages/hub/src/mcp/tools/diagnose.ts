import type { SondeDb } from '../../db/index.js';
import type { AuthContext } from '../../engine/policy.js';
import { evaluateAgentAccess, evaluateProbeAccess } from '../../engine/policy.js';
import type { RunbookEngine } from '../../engine/runbooks.js';
import type { ProbeRouter } from '../../integrations/probe-router.js';

export async function handleDiagnose(
  args: { agent?: string; category: string; description?: string },
  probeRouter: ProbeRouter,
  runbookEngine: RunbookEngine,
  db: SondeDb,
  auth?: AuthContext,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}> {
  try {
    // Check agent access only when an agent is specified
    if (auth && args.agent) {
      const agentDecision = evaluateAgentAccess(auth, args.agent);
      if (!agentDecision.allowed) {
        return {
          content: [{ type: 'text', text: `Access denied: ${agentDecision.reason}` }],
          isError: true,
        };
      }
    }

    const runbook = runbookEngine.getRunbook(args.category);
    if (!runbook) {
      const available = runbookEngine.getCategories();
      return {
        content: [
          {
            type: 'text',
            text: `Error: No runbook for category "${args.category}". Available: ${available.join(', ') || 'none'}`,
          },
        ],
        isError: true,
      };
    }

    const result = await runbookEngine.execute(args.category, args.agent, probeRouter);

    const agentOrSource = args.agent ?? args.category;
    const output = {
      agent: agentOrSource,
      timestamp: new Date().toISOString(),
      category: args.category,
      runbookId: `${args.category}-runbook`,
      findings: result.findings,
      summary: result.summary,
    };

    // Log each probe result to audit, skip probes denied by policy
    for (const [probe, finding] of Object.entries(result.findings)) {
      if (auth) {
        const probeDecision = evaluateProbeAccess(auth, agentOrSource, probe);
        if (!probeDecision.allowed) continue;
      }

      db.logAudit({
        apiKeyId: auth?.keyId,
        agentId: agentOrSource,
        probe,
        status: finding.status,
        durationMs: finding.durationMs,
        requestJson: JSON.stringify({ agent: args.agent, category: args.category }),
        responseJson: JSON.stringify(finding),
      });
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
}
