import { describe, expect, it, vi } from 'vitest';
import type { AgentDispatcher } from '../ws/dispatcher.js';
import type { IntegrationExecutor } from './executor.js';
import { ProbeRouter } from './probe-router.js';

function createMockDispatcher(
  overrides: Partial<AgentDispatcher> = {},
): AgentDispatcher {
  return {
    sendProbe: vi.fn().mockResolvedValue({
      probe: 'system.disk.usage',
      status: 'success',
      data: {},
      durationMs: 10,
      metadata: {
        agentVersion: '0.1.0',
        packName: 'system',
        packVersion: '0.1.0',
        capabilityLevel: 'observe',
      },
    }),
    ...overrides,
  } as unknown as AgentDispatcher;
}

function createMockExecutor(
  overrides: Partial<IntegrationExecutor> = {},
): IntegrationExecutor {
  return {
    isIntegrationProbe: vi.fn().mockReturnValue(false),
    executeProbe: vi.fn().mockResolvedValue({
      probe: 'cloudflare.zones.list',
      status: 'success',
      data: { zones: [] },
      durationMs: 100,
      metadata: {
        agentVersion: 'hub',
        packName: 'cloudflare',
        packVersion: '0.1.0',
        capabilityLevel: 'observe',
      },
    }),
    ...overrides,
  } as unknown as IntegrationExecutor;
}

describe('ProbeRouter', () => {
  it('routes integration probes to executor', async () => {
    const executor = createMockExecutor({
      isIntegrationProbe: vi.fn().mockReturnValue(true),
    });
    const dispatcher = createMockDispatcher();
    const router = new ProbeRouter(dispatcher, executor);

    const result = await router.execute(
      'cloudflare.zones.list',
      { limit: 10 },
    );

    expect(executor.executeProbe).toHaveBeenCalledWith(
      'cloudflare.zones.list',
      { limit: 10 },
    );
    expect(dispatcher.sendProbe).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
  });

  it('routes agent probes to dispatcher', async () => {
    const executor = createMockExecutor();
    const dispatcher = createMockDispatcher();
    const router = new ProbeRouter(dispatcher, executor);

    const result = await router.execute(
      'system.disk.usage',
      undefined,
      'srv1',
    );

    expect(dispatcher.sendProbe).toHaveBeenCalledWith(
      'srv1',
      'system.disk.usage',
      undefined,
    );
    expect(executor.executeProbe).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
  });

  it('throws when agent probe has no agent', async () => {
    const executor = createMockExecutor();
    const dispatcher = createMockDispatcher();
    const router = new ProbeRouter(dispatcher, executor);

    await expect(
      router.execute('system.disk.usage'),
    ).rejects.toThrow(
      "Agent name or ID is required for agent probe 'system.disk.usage'",
    );
  });

  it('ignores agent arg for integration probes', async () => {
    const executor = createMockExecutor({
      isIntegrationProbe: vi.fn().mockReturnValue(true),
    });
    const dispatcher = createMockDispatcher();
    const router = new ProbeRouter(dispatcher, executor);

    const result = await router.execute(
      'cloudflare.zones.list',
      undefined,
      'some-agent',
    );

    expect(executor.executeProbe).toHaveBeenCalledWith(
      'cloudflare.zones.list',
      undefined,
    );
    expect(dispatcher.sendProbe).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
  });
});

describe('ProbeRouter cache', () => {
  it('returns cached response without calling dispatcher', async () => {
    const dispatcher = createMockDispatcher();
    const executor = createMockExecutor();
    const router = new ProbeRouter(
      dispatcher,
      executor,
      undefined,
      undefined,
      { cacheTtlMs: 5000 },
    );

    const first = await router.execute(
      'system.disk.usage',
      undefined,
      'srv1',
    );
    const second = await router.execute(
      'system.disk.usage',
      undefined,
      'srv1',
    );

    expect(first.status).toBe('success');
    expect(second.status).toBe('success');
    // Dispatcher called only once — second call is a cache hit
    expect(dispatcher.sendProbe).toHaveBeenCalledTimes(1);
  });

  it('cache miss for different params calls through', async () => {
    const dispatcher = createMockDispatcher();
    const executor = createMockExecutor();
    const router = new ProbeRouter(
      dispatcher,
      executor,
      undefined,
      undefined,
      { cacheTtlMs: 5000 },
    );

    await router.execute(
      'system.disk.usage',
      { path: '/' },
      'srv1',
    );
    await router.execute(
      'system.disk.usage',
      { path: '/data' },
      'srv1',
    );

    expect(dispatcher.sendProbe).toHaveBeenCalledTimes(2);
  });

  it('cache miss after TTL expiry calls through', async () => {
    const dispatcher = createMockDispatcher();
    const executor = createMockExecutor();
    const router = new ProbeRouter(
      dispatcher,
      executor,
      undefined,
      undefined,
      { cacheTtlMs: 1 },
    );

    await router.execute(
      'system.disk.usage',
      undefined,
      'srv1',
    );

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 10));

    await router.execute(
      'system.disk.usage',
      undefined,
      'srv1',
    );

    expect(dispatcher.sendProbe).toHaveBeenCalledTimes(2);
  });

  it('does not cache error responses', async () => {
    const dispatcher = createMockDispatcher({
      sendProbe: vi.fn().mockResolvedValue({
        probe: 'system.disk.usage',
        status: 'error',
        data: { error: 'failed' },
        durationMs: 10,
      }),
    });
    const executor = createMockExecutor();
    const router = new ProbeRouter(
      dispatcher,
      executor,
      undefined,
      undefined,
      { cacheTtlMs: 5000 },
    );

    await router.execute(
      'system.disk.usage',
      undefined,
      'srv1',
    );
    await router.execute(
      'system.disk.usage',
      undefined,
      'srv1',
    );

    // Called twice because error was not cached
    expect(dispatcher.sendProbe).toHaveBeenCalledTimes(2);
  });

  it('cached response is immune to caller mutation', async () => {
    const dispatcher = createMockDispatcher({
      sendProbe: vi.fn().mockResolvedValue({
        probe: 'system.disk.usage',
        status: 'success',
        data: { usage: 42 },
        durationMs: 10,
      }),
    });
    const executor = createMockExecutor();
    const router = new ProbeRouter(
      dispatcher,
      executor,
      undefined,
      undefined,
      { cacheTtlMs: 5000 },
    );

    const first = await router.execute(
      'system.disk.usage',
      undefined,
      'srv1',
    );
    // Mutate the returned response
    (first.data as Record<string, unknown>).usage = 999;

    const second = await router.execute(
      'system.disk.usage',
      undefined,
      'srv1',
    );

    // Second call should return original value, not mutated
    expect((second.data as Record<string, unknown>).usage).toBe(42);
    expect(dispatcher.sendProbe).toHaveBeenCalledTimes(1);
  });
});
