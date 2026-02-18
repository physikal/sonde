import type { SondeDb } from '../../db/index.js';
import type { AuthContext } from '../../engine/policy.js';
import { evaluateAgentAccess, evaluateProbeAccess } from '../../engine/policy.js';
import type { RunbookEngine } from '../../engine/runbooks.js';
import type { ProbeRouter } from '../../integrations/probe-router.js';

export async function handleDiagnose(
  args: {
    agent?: string;
    category: string;
    description?: string;
    params?: Record<string, unknown>;
  },
  probeRouter: ProbeRouter,
  runbookEngine: RunbookEngine,
  db: SondeDb,
  auth?: AuthContext,
  connectedAgents?: string[],
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

    // Pre-flight: fail fast if a specific agent is requested but offline
    if (args.agent && connectedAgents && !connectedAgents.includes(args.agent)) {
      const agentRow = db.getAgent(args.agent);
      if (!agentRow) {
        return {
          content: [{
            type: 'text',
            text: `Error: Agent "${args.agent}" is not registered with the hub.`,
          }],
          isError: true,
        };
      }
      const lastSeen = agentRow.lastSeen
        ? ` Last seen: ${agentRow.lastSeen}.`
        : '';
      return {
        content: [{
          type: 'text',
          text: `Error: Agent "${args.agent}" is offline.${lastSeen} Check that the agent process is running and can reach the hub.`,
        }],
        isError: true,
      };
    }

    // Check for diagnostic runbook first
    const diagnosticRunbook = runbookEngine.getDiagnosticRunbook(args.category);
    if (diagnosticRunbook) {
      const context = { connectedAgents: connectedAgents ?? [] };
      const result = await runbookEngine.executeDiagnostic(
        args.category,
        args.params ?? {},
        probeRouter,
        context,
      );

      const agentOrSource = args.agent ?? args.category;
      const output = {
        meta: {
          agent: agentOrSource,
          timestamp: new Date().toISOString(),
          category: args.category,
          runbookId: `${args.category}-runbook`,
          ...result.summary,
          truncated: result.truncated ?? false,
          timedOut: result.timedOut ?? false,
        },
        probes: Object.fromEntries(
          Object.entries(result.probeResults).map(([key, pr]) => [
            key,
            { status: pr.status, data: pr.data, durationMs: pr.durationMs, error: pr.error },
          ]),
        ),
        findings: result.findings,
      };

      // Log each probe result to audit
      for (const [probe, probeResult] of Object.entries(result.probeResults)) {
        if (auth) {
          const probeDecision = evaluateProbeAccess(auth, agentOrSource, probe);
          if (!probeDecision.allowed) continue;
        }

        db.logAudit({
          apiKeyId: auth?.keyId,
          agentId: agentOrSource,
          probe,
          status: probeResult.status,
          durationMs: probeResult.durationMs,
          requestJson: JSON.stringify({
            agent: args.agent,
            category: args.category,
            params: args.params,
          }),
          responseJson: JSON.stringify(probeResult),
        });
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      };
    }

    // Fall through to simple runbook path
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
      meta: {
        agent: agentOrSource,
        timestamp: new Date().toISOString(),
        category: args.category,
        runbookId: `${args.category}-runbook`,
        ...result.summary,
      },
      probes: Object.fromEntries(
        Object.entries(result.findings).map(([key, pr]) => [
          key,
          { status: pr.status, data: pr.data, durationMs: pr.durationMs, error: pr.error },
        ]),
      ),
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
