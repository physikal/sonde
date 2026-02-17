import type { PackManifest } from '@sonde/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ProbeRouter } from '../integrations/probe-router.js';
import { RunbookEngine } from './runbooks.js';

function createMockProbeRouter(overrides: Partial<ProbeRouter> = {}): ProbeRouter {
  return {
    execute: vi.fn(),
    ...overrides,
  } as unknown as ProbeRouter;
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
    const probeRouter = createMockProbeRouter({
      execute: vi.fn().mockImplementation(async (probe: string) => ({
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

    const result = await engine.execute('docker', 'test-agent', probeRouter);

    expect(result.category).toBe('docker');
    expect(result.summary.probesRun).toBe(2);
    expect(result.summary.probesSucceeded).toBe(2);
    expect(result.summary.probesFailed).toBe(0);
    expect(result.findings['docker.containers.list']?.status).toBe('success');
    expect(result.findings['docker.daemon.info']?.status).toBe('success');

    // Verify probes were dispatched with fully-qualified names
    expect(probeRouter.execute).toHaveBeenCalledWith('docker.containers.list', undefined, 'test-agent');
    expect(probeRouter.execute).toHaveBeenCalledWith('docker.daemon.info', undefined, 'test-agent');
  });

  it('executes sequential runbook in order', async () => {
    const callOrder: string[] = [];
    const probeRouter = createMockProbeRouter({
      execute: vi.fn().mockImplementation(async (probe: string) => {
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

    const result = await engine.execute('system', 'srv1', probeRouter);

    expect(result.summary.probesRun).toBe(1);
    expect(callOrder).toEqual(['system.disk.usage']);
  });

  it('captures probe errors without failing the runbook', async () => {
    const probeRouter = createMockProbeRouter({
      execute: vi.fn().mockImplementation(async (probe: string) => {
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

    const result = await engine.execute('docker', 'test-agent', probeRouter);

    expect(result.summary.probesSucceeded).toBe(1);
    expect(result.summary.probesFailed).toBe(1);
    expect(result.findings['docker.daemon.info']?.status).toBe('error');
    expect(result.findings['docker.daemon.info']?.error).toBe('Connection refused');
  });

  it('marks timed-out probes correctly', async () => {
    const probeRouter = createMockProbeRouter({
      execute: vi.fn().mockRejectedValue(new Error('Probe timed out after 30000ms')),
    });

    const engine = new RunbookEngine();
    engine.loadFromManifests([systemManifest]);

    const result = await engine.execute('system', 'srv1', probeRouter);

    expect(result.findings['system.disk.usage']?.status).toBe('timeout');
  });

  it('throws when category not found', async () => {
    const probeRouter = createMockProbeRouter();
    const engine = new RunbookEngine();

    await expect(engine.execute('nonexistent', 'agent', probeRouter)).rejects.toThrow(
      'No runbook found for category "nonexistent"',
    );
  });

  it('executes runbook without agent for integration probes', async () => {
    const probeRouter = createMockProbeRouter({
      execute: vi.fn().mockImplementation(async (probe: string) => ({
        probe,
        status: 'success',
        data: {},
        durationMs: 50,
        metadata: {
          agentVersion: 'hub',
          packName: 'system',
          packVersion: '0.1.0',
          capabilityLevel: 'observe',
        },
      })),
    });

    const engine = new RunbookEngine();
    engine.loadFromManifests([systemManifest]);

    const result = await engine.execute('system', undefined, probeRouter);

    expect(result.summary.probesRun).toBe(1);
    expect(probeRouter.execute).toHaveBeenCalledWith('system.disk.usage', undefined, undefined);
  });
});
