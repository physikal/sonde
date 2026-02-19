import type {
  DiagnosticRunbookDefinition,
  DiagnosticRunbookResult,
  RunProbe,
  RunbookProbeResult,
} from '@sonde/packs';
import type { PackManifest } from '@sonde/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ProbeRouter } from '../integrations/probe-router.js';
import { RunbookEngine, truncateProbeData } from './runbooks.js';

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
    expect(probeRouter.execute).toHaveBeenCalledWith(
      'docker.containers.list',
      undefined,
      'test-agent',
    );
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

  it('preserves error message from integration probe error response', async () => {
    const probeRouter = createMockProbeRouter({
      execute: vi.fn().mockResolvedValue({
        probe: 'nutanix.vm.list',
        status: 'error',
        data: { error: 'Authentication failed: invalid credentials' },
        durationMs: 50,
        metadata: {
          agentVersion: 'hub',
          packName: 'nutanix',
          packVersion: '0.1.0',
          capabilityLevel: 'observe',
        },
      }),
    });

    const engine = new RunbookEngine();
    const handler = vi.fn(async (_params: Record<string, unknown>, runProbe: RunProbe) => {
      const result = await runProbe('nutanix.vm.list');
      return {
        category: 'nutanix',
        findings: [],
        probeResults: { 'nutanix.vm.list': result },
        summary: {
          probesRun: 1,
          probesSucceeded: 0,
          probesFailed: 1,
          findingsCount: { info: 0, warning: 0, critical: 0 },
          durationMs: 50,
          summaryText: 'Error',
        },
      } as DiagnosticRunbookResult;
    });
    engine.registerDiagnostic({ category: 'nutanix', description: 'Test', handler });

    const result = await engine.executeDiagnostic('nutanix', {}, probeRouter, {
      connectedAgents: [],
    });

    expect(result.probeResults['nutanix.vm.list']?.error).toBe(
      'Authentication failed: invalid credentials',
    );
  });

  it('falls back to stringified data when error field is not present', async () => {
    const probeRouter = createMockProbeRouter({
      execute: vi.fn().mockResolvedValue({
        probe: 'test.probe',
        status: 'error',
        data: { code: 'ECONNREFUSED' },
        durationMs: 10,
        metadata: {
          agentVersion: 'hub',
          packName: 'test',
          packVersion: '0.1.0',
          capabilityLevel: 'observe',
        },
      }),
    });

    const engine = new RunbookEngine();
    const handler = vi.fn(async (_params: Record<string, unknown>, runProbe: RunProbe) => {
      const result = await runProbe('test.probe');
      return {
        category: 'test',
        findings: [],
        probeResults: { 'test.probe': result },
        summary: {
          probesRun: 1,
          probesSucceeded: 0,
          probesFailed: 1,
          findingsCount: { info: 0, warning: 0, critical: 0 },
          durationMs: 10,
          summaryText: 'Error',
        },
      } as DiagnosticRunbookResult;
    });
    engine.registerDiagnostic({ category: 'test', description: 'Test', handler });

    const result = await engine.executeDiagnostic('test', {}, probeRouter, { connectedAgents: [] });

    expect(result.probeResults['test.probe']?.error).toBe('{"code":"ECONNREFUSED"}');
  });
});

describe('truncateProbeData', () => {
  it('does not truncate data below threshold', () => {
    const probes: Record<string, RunbookProbeResult> = {
      'test.probe': { probe: 'test.probe', status: 'success', data: { value: 42 }, durationMs: 10 },
    };
    const { results, truncated } = truncateProbeData(probes);
    expect(truncated).toBe(false);
    expect(results['test.probe']?.data).toEqual({ value: 42 });
  });

  it('truncates data exceeding threshold', () => {
    const largeData = 'x'.repeat(20_000);
    const probes: Record<string, RunbookProbeResult> = {
      'big.probe': { probe: 'big.probe', status: 'success', data: largeData, durationMs: 10 },
    };
    const { results, truncated } = truncateProbeData(probes, 100);
    expect(truncated).toBe(true);
    const data = results['big.probe']?.data as Record<string, unknown>;
    expect(data._truncated).toBe(true);
    expect(data._originalSize).toBeGreaterThan(100);
    expect(data._maxSize).toBe(100);
  });

  it('only truncates probes that exceed threshold', () => {
    const probes: Record<string, RunbookProbeResult> = {
      'small.probe': { probe: 'small.probe', status: 'success', data: { ok: true }, durationMs: 5 },
      'big.probe': { probe: 'big.probe', status: 'success', data: 'y'.repeat(500), durationMs: 10 },
    };
    const { results, truncated } = truncateProbeData(probes, 100);
    expect(truncated).toBe(true);
    expect(results['small.probe']?.data).toEqual({ ok: true });
    expect((results['big.probe']?.data as Record<string, unknown>)._truncated).toBe(true);
  });
});

describe('RunbookEngine.executeDiagnostic timeout', () => {
  it('returns partial results when runbook times out', async () => {
    const probeRouter = createMockProbeRouter({
      execute: vi.fn().mockImplementation(async (probe: string) => ({
        probe,
        status: 'success',
        data: { value: 1 },
        durationMs: 10,
        metadata: {
          agentVersion: 'hub',
          packName: 'test',
          packVersion: '0.1.0',
          capabilityLevel: 'observe',
        },
      })),
    });

    const engine = new RunbookEngine();
    const handler = vi.fn(async (_params: Record<string, unknown>, runProbe: RunProbe) => {
      await runProbe('fast.probe');
      // Simulate a very slow second probe
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      return {} as DiagnosticRunbookResult;
    });
    engine.registerDiagnostic({ category: 'slow', description: 'Slow test', handler });

    const result = await engine.executeDiagnostic(
      'slow',
      {},
      probeRouter,
      { connectedAgents: [] },
      { timeoutMs: 100 },
    );

    expect(result.timedOut).toBe(true);
    expect(result.probeResults['fast.probe']).toBeDefined();
    expect(result.probeResults['fast.probe']?.status).toBe('success');
    expect(result.summary.summaryText).toContain('timed out');
  });

  it('applies truncation to diagnostic results', async () => {
    const probeRouter = createMockProbeRouter({
      execute: vi.fn().mockResolvedValue({
        probe: 'big.probe',
        status: 'success',
        data: 'z'.repeat(20_000),
        durationMs: 10,
        metadata: {
          agentVersion: 'hub',
          packName: 'test',
          packVersion: '0.1.0',
          capabilityLevel: 'observe',
        },
      }),
    });

    const engine = new RunbookEngine();
    const handler = vi.fn(async (_params: Record<string, unknown>, runProbe: RunProbe) => {
      const result = await runProbe('big.probe');
      return {
        category: 'big',
        findings: [],
        probeResults: { 'big.probe': result },
        summary: {
          probesRun: 1,
          probesSucceeded: 1,
          probesFailed: 0,
          findingsCount: { info: 0, warning: 0, critical: 0 },
          durationMs: 10,
          summaryText: 'Done',
        },
      } as DiagnosticRunbookResult;
    });
    engine.registerDiagnostic({ category: 'big', description: 'Big test', handler });

    const result = await engine.executeDiagnostic(
      'big',
      {},
      probeRouter,
      { connectedAgents: [] },
      { maxProbeDataSize: 100 },
    );

    expect(result.truncated).toBe(true);
    const data = result.probeResults['big.probe']?.data as Record<string, unknown>;
    expect(data._truncated).toBe(true);
  });
});
