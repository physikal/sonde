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
  agent?: string;
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
    agents?: string[];
    offlineAgents?: string[];
    tags?: string[];
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
  params?: Record<string, { type: string; description: string; required?: boolean }>,
): boolean {
  if (!params) return false;
  return Object.values(params).some((p) => p.required);
}

function formatSkipReason(
  category: string,
  params: Record<string, { type: string; description: string; required?: boolean }>,
): string {
  const required = Object.entries(params)
    .filter(([, p]) => p.required)
    .map(([name]) => name);
  return `${category} (requires params: ${required.join(', ')})`;
}

export async function handleHealthCheck(
  args: { agent?: string; categories?: string[]; tags?: string[] },
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
    // When a specific agent is given, tags are ignored
    const useTags = args.tags?.length && !args.agent;
    const normalizedTags = useTags ? args.tags?.map((t) => t.replace(/^#/, '')) : undefined;

    // --- Single-agent path (original behavior) ---
    if (args.agent) {
      return executeSingleAgent(
        args.agent,
        args.categories,
        probeRouter,
        dispatcher,
        db,
        runbookEngine,
        integrationManager,
        packRegistry,
        auth,
      );
    }

    // --- Multi-agent / tag-scoped path ---
    if (normalizedTags) {
      return executeTagScoped(
        normalizedTags,
        args.categories,
        probeRouter,
        dispatcher,
        db,
        runbookEngine,
        integrationManager,
        packRegistry,
        auth,
      );
    }

    // --- No agent, no tags: integrations only ---
    return executeIntegrationsOnly(
      args.categories,
      probeRouter,
      dispatcher,
      runbookEngine,
      integrationManager,
      packRegistry,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
}

async function executeSingleAgent(
  agent: string,
  categories: string[] | undefined,
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
  if (auth) {
    const decision = evaluateAgentAccess(auth, agent);
    if (!decision.allowed) {
      return {
        content: [{ type: 'text', text: `Access denied: ${decision.reason}` }],
        isError: true,
      };
    }
  }

  const online = dispatcher.getOnlineAgents();
  const connectedNames = online.map((a) => a.name);
  const connectedIds = online.map((a) => a.id);
  if (!connectedNames.includes(agent) && !connectedIds.includes(agent)) {
    const agentRow = db.getAgent(agent);
    if (!agentRow) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: Agent "${agent}" is not registered with the hub.`,
          },
        ],
        isError: true,
      };
    }
    const lastSeen = agentRow.lastSeen ? ` Last seen: ${agentRow.lastSeen}.` : '';
    return {
      content: [
        {
          type: 'text',
          text: `Error: Agent "${agent}" is offline.${lastSeen} Check that the agent process is running and can reach the hub.`,
        },
      ],
      isError: true,
    };
  }

  const simpleCategories: string[] = [];
  const agentRow = db.getAgent(agent);
  if (agentRow) {
    for (const pack of agentRow.packs) {
      const packDef = packRegistry.get(pack.name);
      if (packDef?.manifest.runbook) {
        simpleCategories.push(packDef.manifest.runbook.category);
      }
    }
  }

  const { diagnosticCategories, skipped } = discoverIntegrationCategories(
    integrationManager,
    runbookEngine,
  );

  let filteredSimple = simpleCategories;
  let filteredDiagnostic = diagnosticCategories;
  if (categories?.length) {
    const allowed = new Set(categories);
    filteredSimple = simpleCategories.filter((c) => allowed.has(c));
    filteredDiagnostic = diagnosticCategories.filter((c) => allowed.has(c));
  }

  const connectedAgents = dispatcher.getOnlineAgents().map((a) => a.name);
  const startTime = Date.now();

  const { findings, categoryResults, probeStats } = await executeCategories(
    filteredSimple,
    filteredDiagnostic,
    agent,
    probeRouter,
    runbookEngine,
    connectedAgents,
  );

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const output: HealthCheckOutput = {
    meta: {
      agent,
      timestamp: new Date().toISOString(),
      categoriesRun: [...filteredSimple, ...filteredDiagnostic],
      categoriesSkipped: skipped,
      totalDurationMs: Date.now() - startTime,
    },
    summary: {
      critical: findings.filter((f) => f.severity === 'critical').length,
      warning: findings.filter((f) => f.severity === 'warning').length,
      info: findings.filter((f) => f.severity === 'info').length,
      ...probeStats,
    },
    findings,
    categoryResults,
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}

async function executeTagScoped(
  tags: string[],
  categories: string[] | undefined,
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
  const startTime = Date.now();
  const agentTagMap = db.getAllAgentTags();
  const integrationTagMap = db.getAllIntegrationTags();
  const onlineAgents = dispatcher.getOnlineAgents();
  const onlineIds = new Set(onlineAgents.map((a) => a.id));
  const allAgents = db.getAllAgents();

  // Filter agents by tags (AND logic)
  const matchingAgents = allAgents.filter((a) => {
    const agentTags = agentTagMap.get(a.id) ?? [];
    return tags.every((t) => agentTags.includes(t));
  });

  // Apply auth filtering
  const authorizedAgents = matchingAgents.filter((a) => {
    if (!auth) return true;
    return evaluateAgentAccess(auth, a.name).allowed || evaluateAgentAccess(auth, a.id).allowed;
  });

  const onlineMatching = authorizedAgents.filter((a) => onlineIds.has(a.id));
  const offlineMatching = authorizedAgents.filter((a) => !onlineIds.has(a.id));

  // Filter integrations by tags (AND logic)
  const activeIntegrations = integrationManager.list();
  const matchingIntegrations = activeIntegrations.filter((i) => {
    const intTags = integrationTagMap.get(i.id) ?? [];
    return tags.every((t) => intTags.includes(t));
  });

  // Discover categories for matching integrations
  const allCategories = runbookEngine.getCategories();
  const diagnosticCategories: string[] = [];
  const skipped: string[] = [];

  for (const integration of matchingIntegrations) {
    for (const cat of allCategories) {
      const diagRunbook = runbookEngine.getDiagnosticRunbook(cat);
      if (!diagRunbook) continue;
      if (cat !== integration.type && !cat.startsWith(`${integration.type}-`)) {
        continue;
      }
      if (diagRunbook.params && hasRequiredParams(diagRunbook.params)) {
        skipped.push(formatSkipReason(cat, diagRunbook.params));
        continue;
      }
      if (!diagnosticCategories.includes(cat)) {
        diagnosticCategories.push(cat);
      }
    }
  }

  let filteredDiagnostic = diagnosticCategories;
  if (categories?.length) {
    const allowed = new Set(categories);
    filteredDiagnostic = diagnosticCategories.filter((c) => allowed.has(c));
  }

  const findings: Finding[] = [];
  const categoryResults: Record<string, CategoryResult> = {};
  let totalProbesRun = 0;
  let totalProbesSucceeded = 0;
  let totalProbesFailed = 0;
  const categoriesRun: string[] = [];
  const connectedAgents = onlineAgents.map((a) => a.name);

  // Run agent categories across all matching online agents in parallel
  const agentTasks: Array<Promise<void>> = [];
  for (const agent of onlineMatching) {
    const agentSimple: string[] = [];
    for (const pack of agent.packs) {
      const packDef = packRegistry.get(pack.name);
      if (packDef?.manifest.runbook) {
        agentSimple.push(packDef.manifest.runbook.category);
      }
    }

    let filteredSimple = agentSimple;
    if (categories?.length) {
      const allowed = new Set(categories);
      filteredSimple = agentSimple.filter((c) => allowed.has(c));
    }

    for (const cat of filteredSimple) {
      const resultKey = `${agent.name}:${cat}`;
      agentTasks.push(
        (async () => {
          const catStart = Date.now();
          try {
            const result = await runbookEngine.execute(cat, agent.name, probeRouter);
            const catDuration = Date.now() - catStart;
            const catFindings: Finding[] = [];
            for (const [probe, probeResult] of Object.entries(result.findings)) {
              if (probeResult.status === 'success') {
                catFindings.push({
                  severity: 'info',
                  category: cat,
                  agent: agent.name,
                  title: probe,
                  detail: JSON.stringify(probeResult.data),
                });
              } else {
                catFindings.push({
                  severity: 'warning',
                  category: cat,
                  agent: agent.name,
                  title: `${probe} failed`,
                  detail: probeResult.error ?? 'Probe returned non-success',
                });
              }
            }
            findings.push(...catFindings);
            categoryResults[resultKey] = {
              source: 'agent',
              status: 'success',
              durationMs: catDuration,
              probeCount: result.summary.probesRun,
              findingCount: catFindings.length,
            };
            totalProbesRun += result.summary.probesRun;
            totalProbesSucceeded += result.summary.probesSucceeded;
            totalProbesFailed += result.summary.probesFailed;
            if (!categoriesRun.includes(resultKey)) {
              categoriesRun.push(resultKey);
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            categoryResults[resultKey] = {
              source: 'agent',
              status: 'error',
              durationMs: Date.now() - catStart,
              probeCount: 0,
              findingCount: 0,
              error: errorMsg,
            };
            categoriesRun.push(resultKey);
          }
        })(),
      );
    }
  }

  // Run integration diagnostic categories in parallel
  const integrationTasks: Array<Promise<void>> = [];
  for (const cat of filteredDiagnostic) {
    integrationTasks.push(
      (async () => {
        const catStart = Date.now();
        try {
          const context = { connectedAgents };
          const result = await runbookEngine.executeDiagnostic(cat, {}, probeRouter, context);
          const catDuration = Date.now() - catStart;
          const catFindings: Finding[] = result.findings.map((f) => ({
            severity: f.severity,
            category: cat,
            title: f.title,
            detail: f.detail,
            remediation: f.remediation,
          }));
          findings.push(...catFindings);
          categoryResults[cat] = {
            source: 'integration',
            status: 'success',
            durationMs: catDuration,
            probeCount: result.summary.probesRun,
            findingCount: catFindings.length,
          };
          totalProbesRun += result.summary.probesRun;
          totalProbesSucceeded += result.summary.probesSucceeded;
          totalProbesFailed += result.summary.probesFailed;
          categoriesRun.push(cat);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          categoryResults[cat] = {
            source: 'integration',
            status: 'error',
            durationMs: Date.now() - catStart,
            probeCount: 0,
            findingCount: 0,
            error: errorMsg,
          };
          categoriesRun.push(cat);
        }
      })(),
    );
  }

  await Promise.allSettled([...agentTasks, ...integrationTasks]);

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const output: HealthCheckOutput = {
    meta: {
      tags,
      agents: onlineMatching.map((a) => a.name),
      ...(offlineMatching.length > 0 ? { offlineAgents: offlineMatching.map((a) => a.name) } : {}),
      timestamp: new Date().toISOString(),
      categoriesRun,
      categoriesSkipped: skipped,
      totalDurationMs: Date.now() - startTime,
    },
    summary: {
      critical: findings.filter((f) => f.severity === 'critical').length,
      warning: findings.filter((f) => f.severity === 'warning').length,
      info: findings.filter((f) => f.severity === 'info').length,
      probesRun: totalProbesRun,
      probesSucceeded: totalProbesSucceeded,
      probesFailed: totalProbesFailed,
    },
    findings,
    categoryResults,
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}

function discoverIntegrationCategories(
  integrationManager: IntegrationManager,
  runbookEngine: RunbookEngine,
  integrations?: Array<{ type: string }>,
): { diagnosticCategories: string[]; skipped: string[] } {
  const activeIntegrations = integrations ?? integrationManager.list();
  const allCategories = runbookEngine.getCategories();
  const diagnosticCategories: string[] = [];
  const skipped: string[] = [];

  for (const integration of activeIntegrations) {
    for (const cat of allCategories) {
      const diagRunbook = runbookEngine.getDiagnosticRunbook(cat);
      if (!diagRunbook) continue;
      if (cat !== integration.type && !cat.startsWith(`${integration.type}-`)) {
        continue;
      }
      if (diagRunbook.params && hasRequiredParams(diagRunbook.params)) {
        skipped.push(formatSkipReason(cat, diagRunbook.params));
        continue;
      }
      if (!diagnosticCategories.includes(cat)) {
        diagnosticCategories.push(cat);
      }
    }
  }

  return { diagnosticCategories, skipped };
}

async function executeCategories(
  simpleCategories: string[],
  diagnosticCategories: string[],
  agent: string | undefined,
  probeRouter: ProbeRouter,
  runbookEngine: RunbookEngine,
  connectedAgents: string[],
): Promise<{
  findings: Finding[];
  categoryResults: Record<string, CategoryResult>;
  probeStats: {
    probesRun: number;
    probesSucceeded: number;
    probesFailed: number;
  };
}> {
  const findings: Finding[] = [];
  const categoryResults: Record<string, CategoryResult> = {};
  let totalProbesRun = 0;
  let totalProbesSucceeded = 0;
  let totalProbesFailed = 0;

  const tasks: Array<{
    category: string;
    type: 'simple' | 'diagnostic';
  }> = [
    ...simpleCategories.map((c) => ({
      category: c,
      type: 'simple' as const,
    })),
    ...diagnosticCategories.map((c) => ({
      category: c,
      type: 'diagnostic' as const,
    })),
  ];

  const results = await Promise.allSettled(
    tasks.map(async (task) => {
      const catStart = Date.now();

      if (task.type === 'simple') {
        const result = await runbookEngine.execute(task.category, agent, probeRouter);
        const catDuration = Date.now() - catStart;
        const catFindings: Finding[] = [];
        for (const [probe, probeResult] of Object.entries(result.findings)) {
          if (probeResult.status === 'success') {
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
              detail: probeResult.error ?? 'Probe returned non-success',
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

      const context = { connectedAgents };
      const result = await runbookEngine.executeDiagnostic(task.category, {}, probeRouter, context);
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

  for (let i = 0; i < results.length; i++) {
    const settled = results[i];
    const task = tasks[i];
    if (!settled || !task) continue;

    if (settled.status === 'fulfilled') {
      const val = settled.value;
      findings.push(...val.findings);
      categoryResults[val.category] = val.result;
      totalProbesRun += val.probesRun;
      totalProbesSucceeded += val.probesSucceeded;
      totalProbesFailed += val.probesFailed;
    } else {
      const errorMsg = settled.reason instanceof Error ? settled.reason.message : 'Unknown error';
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

  return {
    findings,
    categoryResults,
    probeStats: {
      probesRun: totalProbesRun,
      probesSucceeded: totalProbesSucceeded,
      probesFailed: totalProbesFailed,
    },
  };
}

async function executeIntegrationsOnly(
  categories: string[] | undefined,
  probeRouter: ProbeRouter,
  dispatcher: AgentDispatcher,
  runbookEngine: RunbookEngine,
  integrationManager: IntegrationManager,
  packRegistry: ReadonlyMap<string, Pack>,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}> {
  const { diagnosticCategories, skipped } = discoverIntegrationCategories(
    integrationManager,
    runbookEngine,
  );

  let filteredDiagnostic = diagnosticCategories;
  if (categories?.length) {
    const allowed = new Set(categories);
    filteredDiagnostic = diagnosticCategories.filter((c) => allowed.has(c));
  }

  const connectedAgents = dispatcher.getOnlineAgents().map((a) => a.name);
  const startTime = Date.now();

  const { findings, categoryResults, probeStats } = await executeCategories(
    [],
    filteredDiagnostic,
    undefined,
    probeRouter,
    runbookEngine,
    connectedAgents,
  );

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const output: HealthCheckOutput = {
    meta: {
      timestamp: new Date().toISOString(),
      categoriesRun: filteredDiagnostic,
      categoriesSkipped: skipped,
      totalDurationMs: Date.now() - startTime,
    },
    summary: {
      critical: findings.filter((f) => f.severity === 'critical').length,
      warning: findings.filter((f) => f.severity === 'warning').length,
      info: findings.filter((f) => f.severity === 'info').length,
      ...probeStats,
    },
    findings,
    categoryResults,
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}
