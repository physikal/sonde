import type { PackManifest } from '@sonde/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AgentDispatcher } from '../ws/dispatcher.js';
import { RunbookEngine } from './runbooks.js';

function createMockDispatcher(overrides: Partial<AgentDispatcher> = {}): AgentDispatcher {
  return {
    registerAgent: vi.fn(),
    removeAgent: vi.fn(),
    removeBySocket: vi.fn(),
    isAgentOnline: vi.fn().mockReturnValue(true),
    getOnlineAgentIds: vi.fn().mockReturnValue([]),
    sendProbe: vi.fn(),
    handleResponse: vi.fn(),
    ...overrides,
  } as unknown as AgentDispatcher;
}

const dockerManifest: PackManifest = {
  name: 'docker',
  version: '0.1.0',
  description: 'Docker probes',
  requires: { groups: [], files: [], commands: ['docker'] },
  probes: [
    {
      name: 'containers.list',
      description: 'List containers',
      capability: 'observe',
      timeout: 10_000,
    },
    { name: 'daemon.info', description: 'Daemon info', capability: 'observe', timeout: 10_000 },
  ],
  runbook: {
    category: 'docker',
    probes: ['containers.list', 'daemon.info'],
    parallel: true,
  },
};

const systemManifest: PackManifest = {
  name: 'system',
  version: '0.1.0',
  description: 'System probes',
  requires: { groups: [], files: [], commands: [] },
  probes: [
    { name: 'disk.usage', description: 'Disk usage', capability: 'observe', timeout: 10_000 },
  ],
  runbook: {
    category: 'system',
    probes: ['disk.usage'],
    parallel: false,
  },
};

describe('RunbookEngine', () => {
  it('loads runbooks from manifests', () => {
    const engine = new RunbookEngine();
    engine.loadFromManifests([dockerManifest, systemManifest]);

    expect(engine.getCategories()).toContain('docker');
    expect(engine.getCategories()).toContain('system');
  });

  it('skips manifests without runbooks', () => {
    const noRunbook: PackManifest = {
      name: 'empty',
      version: '0.1.0',
      description: 'No runbook',
      requires: { groups: [], files: [], commands: [] },
      probes: [],
    };

    const engine = new RunbookEngine();
    engine.loadFromManifests([noRunbook]);

    expect(engine.getCategories()).toHaveLength(0);
  });

  it('returns undefined for unknown category', () => {
    const engine = new RunbookEngine();
    expect(engine.getRunbook('unknown')).toBeUndefined();
  });

  it('executes parallel runbook and collects results', async () => {
    const dispatcher = createMockDispatcher({
      sendProbe: vi.fn().mockImplementation(async (_agent: string, probe: string) => ({
        probe,
        status: 'success',
        data: { mock: true },
        durationMs: 10,
        metadata: {
          agentVersion: '0.1.0',
          packName: 'docker',
          packVersion: '0.1.0',
          capabilityLevel: 'observe',
        },
      })),
    });

    const engine = new RunbookEngine();
    engine.loadFromManifests([dockerManifest]);

    const result = await engine.execute('docker', 'test-agent', dispatcher);

    expect(result.category).toBe('docker');
    expect(result.summary.probesRun).toBe(2);
    expect(result.summary.probesSucceeded).toBe(2);
    expect(result.summary.probesFailed).toBe(0);
    expect(result.findings['docker.containers.list']?.status).toBe('success');
    expect(result.findings['docker.daemon.info']?.status).toBe('success');

    // Verify probes were dispatched with fully-qualified names
    expect(dispatcher.sendProbe).toHaveBeenCalledWith('test-agent', 'docker.containers.list');
    expect(dispatcher.sendProbe).toHaveBeenCalledWith('test-agent', 'docker.daemon.info');
  });

  it('executes sequential runbook in order', async () => {
    const callOrder: string[] = [];
    const dispatcher = createMockDispatcher({
      sendProbe: vi.fn().mockImplementation(async (_agent: string, probe: string) => {
        callOrder.push(probe);
        return {
          probe,
          status: 'success',
          data: {},
          durationMs: 5,
          metadata: {
            agentVersion: '0.1.0',
            packName: 'system',
            packVersion: '0.1.0',
            capabilityLevel: 'observe',
          },
        };
      }),
    });

    const engine = new RunbookEngine();
    engine.loadFromManifests([systemManifest]);

    const result = await engine.execute('system', 'srv1', dispatcher);

    expect(result.summary.probesRun).toBe(1);
    expect(callOrder).toEqual(['system.disk.usage']);
  });

  it('captures probe errors without failing the runbook', async () => {
    const dispatcher = createMockDispatcher({
      sendProbe: vi.fn().mockImplementation(async (_agent: string, probe: string) => {
        if (probe === 'docker.daemon.info') {
          throw new Error('Connection refused');
        }
        return {
          probe,
          status: 'success',
          data: {},
          durationMs: 10,
          metadata: {
            agentVersion: '0.1.0',
            packName: 'docker',
            packVersion: '0.1.0',
            capabilityLevel: 'observe',
          },
        };
      }),
    });

    const engine = new RunbookEngine();
    engine.loadFromManifests([dockerManifest]);

    const result = await engine.execute('docker', 'test-agent', dispatcher);

    expect(result.summary.probesSucceeded).toBe(1);
    expect(result.summary.probesFailed).toBe(1);
    expect(result.findings['docker.daemon.info']?.status).toBe('error');
    expect(result.findings['docker.daemon.info']?.error).toBe('Connection refused');
  });

  it('marks timed-out probes correctly', async () => {
    const dispatcher = createMockDispatcher({
      sendProbe: vi.fn().mockRejectedValue(new Error('Probe timed out after 30000ms')),
    });

    const engine = new RunbookEngine();
    engine.loadFromManifests([systemManifest]);

    const result = await engine.execute('system', 'srv1', dispatcher);

    expect(result.findings['system.disk.usage']?.status).toBe('timeout');
  });

  it('throws when category not found', async () => {
    const dispatcher = createMockDispatcher();
    const engine = new RunbookEngine();

    await expect(engine.execute('nonexistent', 'agent', dispatcher)).rejects.toThrow(
      'No runbook found for category "nonexistent"',
    );
  });
});
