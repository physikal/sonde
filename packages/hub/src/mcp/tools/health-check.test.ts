import type { Pack } from '@sonde/packs';
import { describe, expect, it, vi } from 'vitest';
import type { SondeDb } from '../../db/index.js';
import type { RunbookEngine } from '../../engine/runbooks.js';
import type { IntegrationManager } from '../../integrations/manager.js';
import type { ProbeRouter } from '../../integrations/probe-router.js';
import type { AgentDispatcher } from '../../ws/dispatcher.js';
import { handleHealthCheck } from './health-check.js';

function createMockProbeRouter(): ProbeRouter {
  return { execute: vi.fn() } as unknown as ProbeRouter;
}

function createMockDispatcher(online: Array<{ id: string; name: string }> = []): AgentDispatcher {
  return {
    getOnlineAgents: vi.fn().mockReturnValue(online),
    getOnlineAgentIds: vi.fn().mockReturnValue(online.map((a) => a.id)),
  } as unknown as AgentDispatcher;
}

function createMockDb(overrides: Partial<SondeDb> = {}): SondeDb {
  return {
    getAgent: vi.fn().mockReturnValue(undefined),
    getAllAgents: vi.fn().mockReturnValue([]),
    getAllAgentTags: vi.fn().mockReturnValue(new Map()),
    getAllIntegrationTags: vi.fn().mockReturnValue(new Map()),
    logAudit: vi.fn(),
    ...overrides,
  } as unknown as SondeDb;
}

function createMockEngine(overrides: Partial<RunbookEngine> = {}): RunbookEngine {
  return {
    getCategories: vi.fn().mockReturnValue([]),
    getRunbook: vi.fn().mockReturnValue(undefined),
    getDiagnosticRunbook: vi.fn().mockReturnValue(undefined),
    execute: vi.fn().mockResolvedValue({
      category: 'system',
      findings: {},
      summary: {
        probesRun: 0,
        probesSucceeded: 0,
        probesFailed: 0,
        durationMs: 0,
      },
    }),
    executeDiagnostic: vi.fn().mockResolvedValue({
      category: 'test',
      findings: [],
      probeResults: {},
      summary: {
        probesRun: 0,
        probesSucceeded: 0,
        probesFailed: 0,
        findingsCount: { info: 0, warning: 0, critical: 0 },
        durationMs: 0,
        summaryText: '',
      },
    }),
    ...overrides,
  } as unknown as RunbookEngine;
}

function createMockIntegrationManager(
  integrations: Array<Record<string, unknown>> = [],
): IntegrationManager {
  return {
    list: vi.fn().mockReturnValue(integrations),
  } as unknown as IntegrationManager;
}

function createMockPackRegistry(
  packs: Array<{ name: string; runbookCategory?: string }> = [],
): ReadonlyMap<string, Pack> {
  const map = new Map<string, Pack>();
  for (const p of packs) {
    map.set(p.name, {
      manifest: {
        name: p.name,
        version: '0.1.0',
        description: `${p.name} pack`,
        probes: [],
        runbook: p.runbookCategory
          ? {
              category: p.runbookCategory,
              probes: ['test'],
              parallel: true,
            }
          : undefined,
      },
      handlers: {},
    } as unknown as Pack);
  }
  return map;
}

describe('handleHealthCheck', () => {
  it('runs matching simple runbooks for agent in parallel', async () => {
    const engine = createMockEngine({
      getCategories: vi.fn().mockReturnValue(['system', 'docker']),
      execute: vi.fn().mockResolvedValue({
        category: 'system',
        findings: {
          'system.cpu.usage': {
            probe: 'system.cpu.usage',
            status: 'success',
            data: { usage: 45 },
            durationMs: 100,
          },
        },
        summary: {
          probesRun: 1,
          probesSucceeded: 1,
          probesFailed: 0,
          durationMs: 100,
        },
      }),
    });
    const db = createMockDb({
      getAgent: vi.fn().mockReturnValue({
        id: 'a1',
        name: 'srv1',
        packs: [
          { name: 'system', version: '0.1.0', status: 'active' },
          { name: 'docker', version: '0.1.0', status: 'active' },
        ],
      }),
    });
    const dispatcher = createMockDispatcher([{ id: 'a1', name: 'srv1' }]);
    const packRegistry = createMockPackRegistry([
      { name: 'system', runbookCategory: 'system' },
      { name: 'docker', runbookCategory: 'docker' },
    ]);

    const result = await handleHealthCheck(
      { agent: 'srv1' },
      createMockProbeRouter(),
      dispatcher,
      db,
      engine,
      createMockIntegrationManager(),
      packRegistry,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.meta.agent).toBe('srv1');
    expect(parsed.meta.categoriesRun).toContain('system');
    expect(parsed.meta.categoriesRun).toContain('docker');
    expect(parsed.summary.probesRun).toBeGreaterThan(0);
    // engine.execute called twice (system + docker)
    expect(engine.execute).toHaveBeenCalledTimes(2);
    // Agent categories have source: 'agent'
    expect(parsed.categoryResults.system.source).toBe('agent');
    expect(parsed.categoryResults.docker.source).toBe('agent');
  });

  it('runs matching diagnostic runbooks for integrations (no agent)', async () => {
    const engine = createMockEngine({
      getCategories: vi.fn().mockReturnValue(['proxmox-cluster', 'proxmox-storage']),
      getDiagnosticRunbook: vi.fn().mockImplementation((cat: string) => {
        if (cat.startsWith('proxmox')) {
          return { category: cat, description: `${cat} runbook` };
        }
        return undefined;
      }),
      executeDiagnostic: vi.fn().mockResolvedValue({
        category: 'proxmox-cluster',
        findings: [
          {
            severity: 'info',
            title: 'Cluster OK',
            detail: 'All nodes healthy',
            relatedProbes: [],
          },
        ],
        probeResults: {},
        summary: {
          probesRun: 3,
          probesSucceeded: 3,
          probesFailed: 0,
          findingsCount: { info: 1, warning: 0, critical: 0 },
          durationMs: 500,
          summaryText: 'All good',
        },
      }),
    });
    const integrations = [{ type: 'proxmox', name: 'PVE', status: 'active' }];

    const result = await handleHealthCheck(
      {},
      createMockProbeRouter(),
      createMockDispatcher(),
      createMockDb(),
      engine,
      createMockIntegrationManager(integrations),
      createMockPackRegistry(),
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.meta.categoriesRun).toContain('proxmox-cluster');
    expect(parsed.meta.categoriesRun).toContain('proxmox-storage');
    expect(parsed.findings).toHaveLength(2); // 1 finding per category × 2
    expect(engine.executeDiagnostic).toHaveBeenCalledTimes(2);
    // Integration categories have source: 'integration'
    expect(parsed.categoryResults['proxmox-cluster'].source).toBe('integration');
    expect(parsed.categoryResults['proxmox-storage'].source).toBe('integration');
  });

  it('applies category filter', async () => {
    const engine = createMockEngine({
      getCategories: vi.fn().mockReturnValue(['system', 'docker']),
      execute: vi.fn().mockResolvedValue({
        category: 'system',
        findings: {},
        summary: {
          probesRun: 1,
          probesSucceeded: 1,
          probesFailed: 0,
          durationMs: 50,
        },
      }),
    });
    const db = createMockDb({
      getAgent: vi.fn().mockReturnValue({
        id: 'a1',
        name: 'srv1',
        packs: [
          { name: 'system', version: '0.1.0', status: 'active' },
          { name: 'docker', version: '0.1.0', status: 'active' },
        ],
      }),
    });
    const dispatcher = createMockDispatcher([{ id: 'a1', name: 'srv1' }]);
    const packRegistry = createMockPackRegistry([
      { name: 'system', runbookCategory: 'system' },
      { name: 'docker', runbookCategory: 'docker' },
    ]);

    const result = await handleHealthCheck(
      { agent: 'srv1', categories: ['system'] },
      createMockProbeRouter(),
      dispatcher,
      db,
      engine,
      createMockIntegrationManager(),
      packRegistry,
    );

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.meta.categoriesRun).toEqual(['system']);
    expect(engine.execute).toHaveBeenCalledTimes(1);
  });

  it('skips categories with required params', async () => {
    const engine = createMockEngine({
      getCategories: vi.fn().mockReturnValue(['proxmox-vm', 'proxmox-cluster']),
      getDiagnosticRunbook: vi.fn().mockImplementation((cat: string) => {
        if (cat === 'proxmox-vm') {
          return {
            category: 'proxmox-vm',
            description: 'VM check',
            params: {
              vmid: {
                type: 'number',
                description: 'VM ID',
                required: true,
              },
            },
          };
        }
        if (cat === 'proxmox-cluster') {
          return {
            category: 'proxmox-cluster',
            description: 'Cluster check',
          };
        }
        return undefined;
      }),
      executeDiagnostic: vi.fn().mockResolvedValue({
        category: 'proxmox-cluster',
        findings: [],
        probeResults: {},
        summary: {
          probesRun: 1,
          probesSucceeded: 1,
          probesFailed: 0,
          findingsCount: { info: 0, warning: 0, critical: 0 },
          durationMs: 100,
          summaryText: '',
        },
      }),
    });
    const integrations = [{ type: 'proxmox', name: 'PVE', status: 'active' }];

    const result = await handleHealthCheck(
      {},
      createMockProbeRouter(),
      createMockDispatcher(),
      createMockDb(),
      engine,
      createMockIntegrationManager(integrations),
      createMockPackRegistry(),
    );

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.meta.categoriesRun).toEqual(['proxmox-cluster']);
    expect(parsed.meta.categoriesSkipped[0]).toContain('proxmox-vm');
    expect(parsed.meta.categoriesSkipped[0]).toContain('vmid');
  });

  it('fails fast when agent is offline', async () => {
    const db = createMockDb({
      getAgent: vi.fn().mockReturnValue({
        id: 'a1',
        name: 'down-srv',
        lastSeen: '2024-01-15T10:00:00Z',
      }),
    });
    const dispatcher = createMockDispatcher([]); // nobody online

    const result = await handleHealthCheck(
      { agent: 'down-srv' },
      createMockProbeRouter(),
      dispatcher,
      db,
      createMockEngine(),
      createMockIntegrationManager(),
      createMockPackRegistry(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('offline');
    expect(result.content[0]?.text).toContain('Last seen');
  });

  it('fails fast for unregistered agent', async () => {
    const result = await handleHealthCheck(
      { agent: 'ghost' },
      createMockProbeRouter(),
      createMockDispatcher([]),
      createMockDb(),
      createMockEngine(),
      createMockIntegrationManager(),
      createMockPackRegistry(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not registered');
  });

  it('handles partial failure: one category errors, others succeed', async () => {
    let callCount = 0;
    const engine = createMockEngine({
      getCategories: vi.fn().mockReturnValue(['proxmox-cluster', 'proxmox-storage']),
      getDiagnosticRunbook: vi.fn().mockImplementation((cat: string) => {
        if (cat.startsWith('proxmox')) {
          return { category: cat, description: `${cat} runbook` };
        }
        return undefined;
      }),
      executeDiagnostic: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            category: 'proxmox-cluster',
            findings: [
              {
                severity: 'info',
                title: 'OK',
                detail: 'Good',
                relatedProbes: [],
              },
            ],
            probeResults: {},
            summary: {
              probesRun: 1,
              probesSucceeded: 1,
              probesFailed: 0,
              findingsCount: { info: 1, warning: 0, critical: 0 },
              durationMs: 100,
              summaryText: 'OK',
            },
          });
        }
        return Promise.reject(new Error('Connection refused'));
      }),
    });

    const result = await handleHealthCheck(
      {},
      createMockProbeRouter(),
      createMockDispatcher(),
      createMockDb(),
      engine,
      createMockIntegrationManager([{ type: 'proxmox', name: 'PVE', status: 'active' }]),
      createMockPackRegistry(),
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    // One succeeded, one failed
    const categories = Object.values(parsed.categoryResults as Record<string, { status: string }>);
    const statuses = categories.map((c) => c.status);
    expect(statuses).toContain('success');
    expect(statuses).toContain('error');
  });

  it('sorts findings by severity: critical → warning → info', async () => {
    const engine = createMockEngine({
      getCategories: vi.fn().mockReturnValue(['diag-a']),
      getDiagnosticRunbook: vi.fn().mockReturnValue({
        category: 'diag-a',
        description: 'test',
      }),
      executeDiagnostic: vi.fn().mockResolvedValue({
        category: 'diag-a',
        findings: [
          {
            severity: 'info',
            title: 'Info finding',
            detail: 'detail',
            relatedProbes: [],
          },
          {
            severity: 'critical',
            title: 'Critical finding',
            detail: 'detail',
            relatedProbes: [],
          },
          {
            severity: 'warning',
            title: 'Warning finding',
            detail: 'detail',
            relatedProbes: [],
          },
        ],
        probeResults: {},
        summary: {
          probesRun: 3,
          probesSucceeded: 3,
          probesFailed: 0,
          findingsCount: { info: 1, warning: 1, critical: 1 },
          durationMs: 200,
          summaryText: '',
        },
      }),
    });

    const result = await handleHealthCheck(
      {},
      createMockProbeRouter(),
      createMockDispatcher(),
      createMockDb(),
      engine,
      createMockIntegrationManager([{ type: 'diag', name: 'test', status: 'active' }]),
      createMockPackRegistry(),
    );

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.findings[0].severity).toBe('critical');
    expect(parsed.findings[1].severity).toBe('warning');
    expect(parsed.findings[2].severity).toBe('info');
  });

  it('returns success with empty findings when no categories apply', async () => {
    const result = await handleHealthCheck(
      {},
      createMockProbeRouter(),
      createMockDispatcher(),
      createMockDb(),
      createMockEngine(),
      createMockIntegrationManager(),
      createMockPackRegistry(),
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.findings).toEqual([]);
    expect(parsed.meta.categoriesRun).toEqual([]);
    expect(parsed.summary.probesRun).toBe(0);
  });

  it('tags filter to matching agents only', async () => {
    const engine = createMockEngine({
      execute: vi.fn().mockResolvedValue({
        category: 'system',
        findings: {
          'system.cpu.usage': {
            probe: 'system.cpu.usage',
            status: 'success',
            data: { usage: 30 },
            durationMs: 50,
          },
        },
        summary: {
          probesRun: 1,
          probesSucceeded: 1,
          probesFailed: 0,
          durationMs: 50,
        },
      }),
    });
    const agentTags = new Map([
      ['a1', ['storefront', 'prod']],
      ['a2', ['backend', 'prod']],
    ]);
    const db = createMockDb({
      getAllAgents: vi.fn().mockReturnValue([
        {
          id: 'a1',
          name: 'store01',
          packs: [{ name: 'system', version: '0.1.0' }],
        },
        {
          id: 'a2',
          name: 'api01',
          packs: [{ name: 'system', version: '0.1.0' }],
        },
      ]),
      getAllAgentTags: vi.fn().mockReturnValue(agentTags),
    });
    const dispatcher = createMockDispatcher([
      { id: 'a1', name: 'store01' },
      { id: 'a2', name: 'api01' },
    ]);
    const packRegistry = createMockPackRegistry([{ name: 'system', runbookCategory: 'system' }]);

    const result = await handleHealthCheck(
      { tags: ['storefront'] },
      createMockProbeRouter(),
      dispatcher,
      db,
      engine,
      createMockIntegrationManager(),
      packRegistry,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.meta.agents).toEqual(['store01']);
    expect(parsed.meta.tags).toEqual(['storefront']);
    // Only store01's system category should run
    expect(parsed.categoryResults['store01:system']).toBeDefined();
    expect(parsed.categoryResults['api01:system']).toBeUndefined();
    expect(engine.execute).toHaveBeenCalledTimes(1);
  });

  it('tags filter to matching integrations only', async () => {
    const engine = createMockEngine({
      getCategories: vi.fn().mockReturnValue(['proxmox-cluster', 'httpbin']),
      getDiagnosticRunbook: vi.fn().mockImplementation((cat: string) => {
        if (cat === 'proxmox-cluster') {
          return { category: cat, description: 'cluster check' };
        }
        if (cat === 'httpbin') {
          return { category: cat, description: 'httpbin check' };
        }
        return undefined;
      }),
      executeDiagnostic: vi.fn().mockResolvedValue({
        category: 'test',
        findings: [],
        probeResults: {},
        summary: {
          probesRun: 1,
          probesSucceeded: 1,
          probesFailed: 0,
          findingsCount: { info: 0, warning: 0, critical: 0 },
          durationMs: 100,
          summaryText: '',
        },
      }),
    });
    const integrationTags = new Map([
      ['i1', ['prod']],
      ['i2', ['dev']],
    ]);
    const db = createMockDb({
      getAllIntegrationTags: vi.fn().mockReturnValue(integrationTags),
    });
    const integrations = [
      { id: 'i1', type: 'proxmox', name: 'PVE-Prod', status: 'active' },
      { id: 'i2', type: 'httpbin', name: 'Test API', status: 'active' },
    ];

    const result = await handleHealthCheck(
      { tags: ['prod'] },
      createMockProbeRouter(),
      createMockDispatcher(),
      db,
      engine,
      createMockIntegrationManager(integrations),
      createMockPackRegistry(),
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    // Only proxmox-cluster should run (i1 has 'prod' tag, i2 does not)
    expect(parsed.categoryResults['proxmox-cluster']).toBeDefined();
    expect(parsed.categoryResults.httpbin).toBeUndefined();
  });

  it('tags + agent: agent takes priority, tags ignored', async () => {
    const engine = createMockEngine({
      execute: vi.fn().mockResolvedValue({
        category: 'system',
        findings: {},
        summary: {
          probesRun: 1,
          probesSucceeded: 1,
          probesFailed: 0,
          durationMs: 50,
        },
      }),
    });
    const db = createMockDb({
      getAgent: vi.fn().mockReturnValue({
        id: 'a1',
        name: 'srv1',
        packs: [{ name: 'system', version: '0.1.0' }],
      }),
    });
    const dispatcher = createMockDispatcher([{ id: 'a1', name: 'srv1' }]);
    const packRegistry = createMockPackRegistry([{ name: 'system', runbookCategory: 'system' }]);

    const result = await handleHealthCheck(
      { agent: 'srv1', tags: ['storefront'] },
      createMockProbeRouter(),
      dispatcher,
      db,
      engine,
      createMockIntegrationManager(),
      packRegistry,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    // Uses single-agent path: meta.agent set, meta.agents/tags not set
    expect(parsed.meta.agent).toBe('srv1');
    expect(parsed.meta.agents).toBeUndefined();
    expect(parsed.meta.tags).toBeUndefined();
  });

  it('tags with no matches returns empty results', async () => {
    const db = createMockDb({
      getAllAgentTags: vi.fn().mockReturnValue(new Map()),
      getAllIntegrationTags: vi.fn().mockReturnValue(new Map()),
    });

    const result = await handleHealthCheck(
      { tags: ['nonexistent'] },
      createMockProbeRouter(),
      createMockDispatcher(),
      db,
      createMockEngine(),
      createMockIntegrationManager(),
      createMockPackRegistry(),
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.meta.agents).toEqual([]);
    expect(parsed.findings).toEqual([]);
    expect(parsed.summary.probesRun).toBe(0);
  });

  it('multi-agent: results keyed by agent:category', async () => {
    const engine = createMockEngine({
      execute: vi.fn().mockResolvedValue({
        category: 'system',
        findings: {
          'system.cpu.usage': {
            probe: 'system.cpu.usage',
            status: 'success',
            data: { usage: 50 },
            durationMs: 50,
          },
        },
        summary: {
          probesRun: 1,
          probesSucceeded: 1,
          probesFailed: 0,
          durationMs: 50,
        },
      }),
    });
    const agentTags = new Map([
      ['a1', ['prod']],
      ['a2', ['prod']],
    ]);
    const db = createMockDb({
      getAllAgents: vi.fn().mockReturnValue([
        {
          id: 'a1',
          name: 'web01',
          packs: [{ name: 'system', version: '0.1.0' }],
        },
        {
          id: 'a2',
          name: 'web02',
          packs: [{ name: 'system', version: '0.1.0' }],
        },
      ]),
      getAllAgentTags: vi.fn().mockReturnValue(agentTags),
    });
    const dispatcher = createMockDispatcher([
      { id: 'a1', name: 'web01' },
      { id: 'a2', name: 'web02' },
    ]);
    const packRegistry = createMockPackRegistry([{ name: 'system', runbookCategory: 'system' }]);

    const result = await handleHealthCheck(
      { tags: ['prod'] },
      createMockProbeRouter(),
      dispatcher,
      db,
      engine,
      createMockIntegrationManager(),
      packRegistry,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.categoryResults['web01:system']).toBeDefined();
    expect(parsed.categoryResults['web02:system']).toBeDefined();
    expect(parsed.meta.agents).toContain('web01');
    expect(parsed.meta.agents).toContain('web02');
    expect(engine.execute).toHaveBeenCalledTimes(2);
  });

  it('offline matching agents listed in meta.offlineAgents', async () => {
    const agentTags = new Map([
      ['a1', ['prod']],
      ['a2', ['prod']],
    ]);
    const db = createMockDb({
      getAllAgents: vi.fn().mockReturnValue([
        {
          id: 'a1',
          name: 'live-srv',
          packs: [{ name: 'system', version: '0.1.0' }],
        },
        {
          id: 'a2',
          name: 'dead-srv',
          packs: [{ name: 'system', version: '0.1.0' }],
        },
      ]),
      getAllAgentTags: vi.fn().mockReturnValue(agentTags),
    });
    const dispatcher = createMockDispatcher([{ id: 'a1', name: 'live-srv' }]);
    const engine = createMockEngine({
      execute: vi.fn().mockResolvedValue({
        category: 'system',
        findings: {},
        summary: {
          probesRun: 1,
          probesSucceeded: 1,
          probesFailed: 0,
          durationMs: 50,
        },
      }),
    });
    const packRegistry = createMockPackRegistry([{ name: 'system', runbookCategory: 'system' }]);

    const result = await handleHealthCheck(
      { tags: ['prod'] },
      createMockProbeRouter(),
      dispatcher,
      db,
      engine,
      createMockIntegrationManager(),
      packRegistry,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.meta.agents).toEqual(['live-srv']);
    expect(parsed.meta.offlineAgents).toEqual(['dead-srv']);
    // Only live agent's categories executed
    expect(parsed.categoryResults['live-srv:system']).toBeDefined();
    expect(parsed.categoryResults['dead-srv:system']).toBeUndefined();
  });

  it('tags strip # prefix', async () => {
    const agentTags = new Map([['a1', ['prod']]]);
    const db = createMockDb({
      getAllAgents: vi.fn().mockReturnValue([
        {
          id: 'a1',
          name: 'srv1',
          packs: [],
        },
      ]),
      getAllAgentTags: vi.fn().mockReturnValue(agentTags),
    });

    const result = await handleHealthCheck(
      { tags: ['#prod'] },
      createMockProbeRouter(),
      createMockDispatcher([{ id: 'a1', name: 'srv1' }]),
      db,
      createMockEngine(),
      createMockIntegrationManager(),
      createMockPackRegistry(),
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.meta.agents).toEqual(['srv1']);
    expect(parsed.meta.tags).toEqual(['prod']);
  });
});
