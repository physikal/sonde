import { describe, expect, it, vi } from 'vitest';
import type { Pack } from '@sonde/packs';
import type { SondeDb } from '../../db/index.js';
import type { RunbookEngine } from '../../engine/runbooks.js';
import type { IntegrationManager } from '../../integrations/manager.js';
import type { AgentDispatcher } from '../../ws/dispatcher.js';
import { handleListCapabilities } from './list-capabilities.js';

function createMockDb(
  agents: Array<Record<string, unknown>> = [],
): SondeDb {
  return {
    getAllAgents: vi.fn().mockReturnValue(agents),
    getAllAgentTags: vi.fn().mockReturnValue(new Map()),
    getAllIntegrationTags: vi.fn().mockReturnValue(new Map()),
  } as unknown as SondeDb;
}

function createMockDispatcher(
  onlineIds: string[] = [],
): AgentDispatcher {
  return {
    getOnlineAgentIds: vi.fn().mockReturnValue(onlineIds),
  } as unknown as AgentDispatcher;
}

function createMockEngine(
  overrides: Partial<RunbookEngine> = {},
): RunbookEngine {
  return {
    getCategories: vi.fn().mockReturnValue([]),
    getRunbook: vi.fn().mockReturnValue(undefined),
    getDiagnosticRunbook: vi.fn().mockReturnValue(undefined),
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

describe('handleListCapabilities', () => {
  it('returns agents with packs and matching runbook categories', () => {
    const db = createMockDb([
      {
        id: 'a1',
        name: 'server-1',
        status: 'offline',
        lastSeen: '2024-01-15T10:00:00Z',
        packs: [
          { name: 'system', version: '0.1.0', status: 'active' },
          { name: 'docker', version: '0.1.0', status: 'active' },
        ],
      },
    ]);
    const dispatcher = createMockDispatcher(['a1']);
    const engine = createMockEngine({
      getCategories: vi.fn().mockReturnValue(['system', 'docker']),
    });
    const packRegistry = createMockPackRegistry([
      { name: 'system', runbookCategory: 'system' },
      { name: 'docker', runbookCategory: 'docker' },
    ]);

    const result = handleListCapabilities(
      db,
      dispatcher,
      engine,
      createMockIntegrationManager(),
      packRegistry,
    );

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0].name).toBe('server-1');
    expect(parsed.agents[0].status).toBe('online');
    expect(parsed.agents[0].packs).toHaveLength(2);
    expect(parsed.agents[0].runbookCategories).toEqual([
      'system',
      'docker',
    ]);
  });

  it('returns integrations with matching diagnostic categories', () => {
    const engine = createMockEngine({
      getCategories: vi
        .fn()
        .mockReturnValue([
          'proxmox-vm',
          'proxmox-cluster',
          'proxmox-storage',
        ]),
      getDiagnosticRunbook: vi.fn().mockImplementation((cat: string) => {
        if (cat.startsWith('proxmox')) {
          return { category: cat, description: `${cat} runbook` };
        }
        return undefined;
      }),
    });
    const integrations = [
      {
        id: 'i1',
        type: 'proxmox',
        name: 'Proxmox Cluster',
        status: 'active',
      },
    ];

    const result = handleListCapabilities(
      createMockDb(),
      createMockDispatcher(),
      engine,
      createMockIntegrationManager(integrations),
      createMockPackRegistry(),
    );

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.integrations).toHaveLength(1);
    expect(parsed.integrations[0].diagnosticCategories).toEqual([
      'proxmox-vm',
      'proxmox-cluster',
      'proxmox-storage',
    ]);
  });

  it('shows offline agents with status offline', () => {
    const db = createMockDb([
      {
        id: 'a1',
        name: 'offline-server',
        status: 'offline',
        lastSeen: '2024-01-15T10:00:00Z',
        packs: [],
      },
    ]);
    const dispatcher = createMockDispatcher([]); // no online agents

    const result = handleListCapabilities(
      db,
      dispatcher,
      createMockEngine(),
      createMockIntegrationManager(),
      createMockPackRegistry(),
    );

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.agents[0].status).toBe('offline');
  });

  it('filters out unauthorized agents via policy', () => {
    const db = createMockDb([
      {
        id: 'a1',
        name: 'allowed-srv',
        status: 'offline',
        lastSeen: '2024-01-15T10:00:00Z',
        packs: [],
      },
      {
        id: 'a2',
        name: 'denied-srv',
        status: 'offline',
        lastSeen: '2024-01-15T10:00:00Z',
        packs: [],
      },
    ]);

    const auth = {
      type: 'api_key' as const,
      keyId: 'k1',
      policy: { allowedAgents: ['allowed-srv'] },
    };

    const result = handleListCapabilities(
      db,
      createMockDispatcher(),
      createMockEngine(),
      createMockIntegrationManager(),
      createMockPackRegistry(),
      auth,
    );

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0].name).toBe('allowed-srv');
  });

  it('returns empty arrays when nothing is available', () => {
    const result = handleListCapabilities(
      createMockDb(),
      createMockDispatcher(),
      createMockEngine(),
      createMockIntegrationManager(),
      createMockPackRegistry(),
    );

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.agents).toEqual([]);
    expect(parsed.integrations).toEqual([]);
    expect(parsed.runbookCategories).toEqual([]);
  });

  it('includes runbook category metadata with params', () => {
    const engine = createMockEngine({
      getCategories: vi
        .fn()
        .mockReturnValue(['proxmox-vm', 'system']),
      getDiagnosticRunbook: vi.fn().mockImplementation((cat: string) => {
        if (cat === 'proxmox-vm') {
          return {
            category: 'proxmox-vm',
            description: 'VM health check',
            params: {
              vmid: {
                type: 'number',
                description: 'VM ID',
                required: true,
              },
            },
          };
        }
        return undefined;
      }),
      getRunbook: vi.fn().mockImplementation((cat: string) => {
        if (cat === 'system') {
          return {
            packName: 'system',
            definition: { category: 'system' },
          };
        }
        return undefined;
      }),
    });

    const result = handleListCapabilities(
      createMockDb(),
      createMockDispatcher(),
      engine,
      createMockIntegrationManager(),
      createMockPackRegistry(),
    );

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.runbookCategories).toHaveLength(2);

    const proxmoxVm = parsed.runbookCategories.find(
      (c: { category: string }) => c.category === 'proxmox-vm',
    );
    expect(proxmoxVm.type).toBe('diagnostic');
    expect(proxmoxVm.params.vmid.required).toBe(true);

    const system = parsed.runbookCategories.find(
      (c: { category: string }) => c.category === 'system',
    );
    expect(system.type).toBe('simple');
  });
});
