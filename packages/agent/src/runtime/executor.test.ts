import type { ExecFn, Pack } from '@sonde/packs';
import type { ProbeRequest } from '@sonde/shared';
import { describe, expect, it, vi } from 'vitest';
import { ProbeExecutor } from './executor.js';

function createMockPack(overrides?: Partial<Pack>): Pack {
  return {
    manifest: {
      name: 'test',
      version: '1.0.0',
      description: 'Test pack',
      requires: { groups: [], files: [], commands: [] },
      probes: [{ name: 'echo', description: 'Echo test', capability: 'observe', timeout: 5000 }],
    },
    handlers: {
      'test.echo': vi.fn().mockResolvedValue({ message: 'hello' }),
    },
    ...overrides,
  };
}

function makeRequest(probe: string, params?: Record<string, unknown>): ProbeRequest {
  return {
    probe,
    params,
    timeout: 30_000,
    requestedBy: 'test',
  };
}

describe('ProbeExecutor', () => {
  it('executes a probe and returns success response', async () => {
    const pack = createMockPack();
    const packs = new Map([['test', pack]]);
    const executor = new ProbeExecutor(packs);

    const result = await executor.execute(makeRequest('test.echo'));

    expect(result.status).toBe('success');
    expect(result.probe).toBe('test.echo');
    expect(result.data).toEqual({ message: 'hello' });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.metadata.packName).toBe('test');
    expect(result.metadata.packVersion).toBe('1.0.0');
  });

  it('passes params and exec to handler', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const mockExec: ExecFn = vi.fn();
    const pack = createMockPack({ handlers: { 'test.echo': handler } });
    const packs = new Map([['test', pack]]);
    const executor = new ProbeExecutor(packs, mockExec);

    await executor.execute(makeRequest('test.echo', { verbose: true }));

    expect(handler).toHaveBeenCalledWith({ verbose: true }, mockExec);
  });

  it('returns error for unknown pack', async () => {
    const executor = new ProbeExecutor(new Map());

    const result = await executor.execute(makeRequest('missing.probe'));

    expect(result.status).toBe('error');
    expect(result.data).toEqual({ error: "Pack 'missing' not loaded" });
  });

  it('returns error for unknown probe within pack', async () => {
    const pack = createMockPack();
    const packs = new Map([['test', pack]]);
    const executor = new ProbeExecutor(packs);

    const result = await executor.execute(makeRequest('test.nonexistent'));

    expect(result.status).toBe('error');
    expect(result.data).toEqual({ error: 'Unknown probe: test.nonexistent' });
  });

  it('returns error when handler throws', async () => {
    const pack = createMockPack({
      handlers: {
        'test.echo': vi.fn().mockRejectedValue(new Error('Command failed')),
      },
    });
    const packs = new Map([['test', pack]]);
    const executor = new ProbeExecutor(packs);

    const result = await executor.execute(makeRequest('test.echo'));

    expect(result.status).toBe('error');
    expect(result.data).toEqual({ error: 'Command failed' });
    expect(result.metadata.packName).toBe('test');
  });

  it('returns error for invalid probe name', async () => {
    const executor = new ProbeExecutor(new Map());

    const result = await executor.execute(makeRequest(''));

    expect(result.status).toBe('error');
  });

  it('reports loaded packs', () => {
    const pack = createMockPack();
    const packs = new Map([['test', pack]]);
    const executor = new ProbeExecutor(packs);

    const loaded = executor.getLoadedPacks();

    expect(loaded).toEqual([{ name: 'test', version: '1.0.0', status: 'active' }]);
  });
});
