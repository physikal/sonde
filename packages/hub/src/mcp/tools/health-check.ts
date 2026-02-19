import type { Pack } from '@sonde/packs';
import type { SondeDb } from '../../db/index.js';
import type { AuthContext } from '../../engine/policy.js';
import { evaluateAgentAccess } from '../../engine/policy.js';
import type { RunbookEngine } from '../../engine/runbooks.js';
import type { IntegrationManager } from '../../integrations/manager.js';
import type { ProbeRouter } from '../../integrations/probe-router.js';
import type { AgentDispatcher } from '../../ws/dispatcher.js';

type Severity = 'critical' | 'warning' | 'info';

interface Finding {
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  remediation?: string;
}

interface CategoryResult {
  source: 'agent' | 'integration';
  status: 'success' | 'error';
  durationMs: number;
  probeCount: number;
  findingCount: number;
  error?: string;
}

interface HealthCheckOutput {
  meta: {
    agent?: string;
    timestamp: string;
    categoriesRun: string[];
    categoriesSkipped: string[];
    totalDurationMs: number;
  };
  summary: {
    critical: number;
    warning: number;
    info: number;
    probesRun: number;
    probesSucceeded: number;
    probesFailed: number;
  };
  findings: Finding[];
  categoryResults: Record<string, CategoryResult>;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function hasRequiredParams(
  params?: Record<
    string,
    { type: string; description: string; required?: boolean }
  >,
): boolean {
  if (!params) return false;
  return Object.values(params).some((p) => p.required);
}

function formatSkipReason(
  category: string,
  params: Record<
    string,
    { type: string; description: string; required?: boolean }
  >,
): string {
  const required = Object.entries(params)
    .filter(([, p]) => p.required)
    .map(([name]) => name);
  return `${category} (requires params: ${required.join(', ')})`;
}

export async function handleHealthCheck(
  args: { agent?: string; categories?: string[] },
  probeRouter: ProbeRouter,
  dispatcher: AgentDispatcher,
  db: SondeDb,
  runbookEngine: RunbookEngine,
  integrationManager: IntegrationManager,
  packRegistry: ReadonlyMap<string, Pack>,
  auth?: AuthContext,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}> {
  try {
    // Pre-flight: agent access and online check
    if (args.agent) {
      if (auth) {
        const decision = evaluateAgentAccess(auth, args.agent);
        if (!decision.allowed) {
          return {
            content: [
              {
                type: 'text',
                text: `Access denied: ${decision.reason}`,
              },
            ],
            isError: true,
          };
        }
      }

      const online = dispatcher.getOnlineAgents();
      const connectedNames = online.map((a) => a.name);
      const connectedIds = online.map((a) => a.id);
      if (
        !connectedNames.includes(args.agent) &&
        !connectedIds.includes(args.agent)
      ) {
        const agentRow = db.getAgent(args.agent);
        if (!agentRow) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Agent "${args.agent}" is not registered with the hub.`,
              },
            ],
            isError: true,
          };
        }
        const lastSeen = agentRow.lastSeen
          ? ` Last seen: ${agentRow.lastSeen}.`
          : '';
        return {
          content: [
            {
              type: 'text',
              text: `Error: Agent "${args.agent}" is offline.${lastSeen} Check that the agent process is running and can reach the hub.`,
            },
          ],
          isError: true,
        };
      }
    }

    // Discover applicable categories
    const simpleCategories: string[] = [];
    const diagnosticCategories: string[] = [];
    const skipped: string[] = [];
    const connectedAgents = dispatcher
      .getOnlineAgents()
      .map((a) => a.name);

    // Agent-specific: match packs to simple runbook categories
    if (args.agent) {
      const agentRow = db.getAgent(args.agent);
      if (agentRow) {
        for (const pack of agentRow.packs) {
          const packDef = packRegistry.get(pack.name);
          if (packDef?.manifest.runbook) {
            simpleCategories.push(
              packDef.manifest.runbook.category,
            );
          }
        }
      }
    }

    // Integration-based: match active integrations to diagnostic categories
    const activeIntegrations = integrationManager.list();
    const allCategories = runbookEngine.getCategories();

    for (const integration of activeIntegrations) {
      for (const cat of allCategories) {
        const diagRunbook = runbookEngine.getDiagnosticRunbook(cat);
        if (!diagRunbook) continue;
        if (
          cat !== integration.type &&
          !cat.startsWith(integration.type + '-')
        ) {
          continue;
        }

        if (hasRequiredParams(diagRunbook.params)) {
          skipped.push(formatSkipReason(cat, diagRunbook.params!));
          continue;
        }

        if (!diagnosticCategories.includes(cat)) {
          diagnosticCategories.push(cat);
        }
      }
    }

    // Apply category filter if specified
    let filteredSimple = simpleCategories;
    let filteredDiagnostic = diagnosticCategories;
    if (args.categories && args.categories.length > 0) {
      const allowed = new Set(args.categories);
      filteredSimple = simpleCategories.filter((c) =>
        allowed.has(c),
      );
      filteredDiagnostic = diagnosticCategories.filter((c) =>
        allowed.has(c),
      );
    }

    const startTime = Date.now();
    const findings: Finding[] = [];
    const categoryResults: Record<string, CategoryResult> = {};
    let totalProbesRun = 0;
    let totalProbesSucceeded = 0;
    let totalProbesFailed = 0;

    // Execute all categories in parallel
    const tasks: Array<{
      category: string;
      type: 'simple' | 'diagnostic';
    }> = [
      ...filteredSimple.map((c) => ({
        category: c,
        type: 'simple' as const,
      })),
      ...filteredDiagnostic.map((c) => ({
        category: c,
        type: 'diagnostic' as const,
      })),
    ];

    const results = await Promise.allSettled(
      tasks.map(async (task) => {
        const catStart = Date.now();

        if (task.type === 'simple') {
          const result = await runbookEngine.execute(
            task.category,
            args.agent,
            probeRouter,
          );
          const catDuration = Date.now() - catStart;

          // Convert simple runbook results to findings
          const catFindings: Finding[] = [];
          for (const [probe, probeResult] of Object.entries(
            result.findings,
          )) {
            if (
              probeResult.status === 'success'
            ) {
              catFindings.push({
                severity: 'info',
                category: task.category,
                title: probe,
                detail: JSON.stringify(probeResult.data),
              });
            } else {
              catFindings.push({
                severity: 'warning',
                category: task.category,
                title: `${probe} failed`,
                detail:
                  probeResult.error ?? 'Probe returned non-success',
              });
            }
          }

          return {
            category: task.category,
            findings: catFindings,
            result: {
              source: 'agent' as const,
              status: 'success' as const,
              durationMs: catDuration,
              probeCount: result.summary.probesRun,
              findingCount: catFindings.length,
            },
            probesRun: result.summary.probesRun,
            probesSucceeded: result.summary.probesSucceeded,
            probesFailed: result.summary.probesFailed,
          };
        }

        // Diagnostic runbook
        const context = { connectedAgents };
        const result = await runbookEngine.executeDiagnostic(
          task.category,
          {},
          probeRouter,
          context,
        );
        const catDuration = Date.now() - catStart;

        const catFindings: Finding[] = result.findings.map((f) => ({
          severity: f.severity,
          category: task.category,
          title: f.title,
          detail: f.detail,
          remediation: f.remediation,
        }));

        return {
          category: task.category,
          findings: catFindings,
          result: {
            source: 'integration' as const,
            status: 'success' as const,
            durationMs: catDuration,
            probeCount: result.summary.probesRun,
            findingCount: catFindings.length,
          },
          probesRun: result.summary.probesRun,
          probesSucceeded: result.summary.probesSucceeded,
          probesFailed: result.summary.probesFailed,
        };
      }),
    );

    // Aggregate results
    for (let i = 0; i < results.length; i++) {
      const settled = results[i]!;
      const task = tasks[i]!;

      if (settled.status === 'fulfilled') {
        const val = settled.value;
        findings.push(...val.findings);
        categoryResults[val.category] = val.result;
        totalProbesRun += val.probesRun;
        totalProbesSucceeded += val.probesSucceeded;
        totalProbesFailed += val.probesFailed;
      } else {
        const errorMsg =
          settled.reason instanceof Error
            ? settled.reason.message
            : 'Unknown error';
        categoryResults[task.category] = {
          source: task.type === 'simple' ? 'agent' : 'integration',
          status: 'error',
          durationMs: 0,
          probeCount: 0,
          findingCount: 0,
          error: errorMsg,
        };
      }
    }

    // Sort findings by severity
    findings.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );

    const output: HealthCheckOutput = {
      meta: {
        agent: args.agent,
        timestamp: new Date().toISOString(),
        categoriesRun: tasks.map((t) => t.category),
        categoriesSkipped: skipped,
        totalDurationMs: Date.now() - startTime,
      },
      summary: {
        critical: findings.filter((f) => f.severity === 'critical')
          .length,
        warning: findings.filter((f) => f.severity === 'warning')
          .length,
        info: findings.filter((f) => f.severity === 'info').length,
        probesRun: totalProbesRun,
        probesSucceeded: totalProbesSucceeded,
        probesFailed: totalProbesFailed,
      },
      findings,
      categoryResults,
    };

    return {
      content: [
        { type: 'text', text: JSON.stringify(output, null, 2) },
      ],
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
}
