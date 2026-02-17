import { describe, expect, it, vi } from 'vitest';
import type { AgentDispatcher } from '../ws/dispatcher.js';
import type { IntegrationExecutor } from './executor.js';
import { ProbeRouter } from './probe-router.js';

function createMockDispatcher(overrides: Partial<AgentDispatcher> = {}): AgentDispatcher {
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

function createMockExecutor(overrides: Partial<IntegrationExecutor> = {}): IntegrationExecutor {
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

    const result = await router.execute('cloudflare.zones.list', { limit: 10 });

    expect(executor.executeProbe).toHaveBeenCalledWith('cloudflare.zones.list', { limit: 10 });
    expect(dispatcher.sendProbe).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
  });

  it('routes agent probes to dispatcher', async () => {
    const executor = createMockExecutor();
    const dispatcher = createMockDispatcher();
    const router = new ProbeRouter(dispatcher, executor);

    const result = await router.execute('system.disk.usage', undefined, 'srv1');

    expect(dispatcher.sendProbe).toHaveBeenCalledWith('srv1', 'system.disk.usage', undefined);
    expect(executor.executeProbe).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
  });

  it('throws when agent probe has no agent', async () => {
    const executor = createMockExecutor();
    const dispatcher = createMockDispatcher();
    const router = new ProbeRouter(dispatcher, executor);

    await expect(router.execute('system.disk.usage')).rejects.toThrow(
      "Agent name or ID is required for agent probe 'system.disk.usage'",
    );
  });

  it('ignores agent arg for integration probes', async () => {
    const executor = createMockExecutor({
      isIntegrationProbe: vi.fn().mockReturnValue(true),
    });
    const dispatcher = createMockDispatcher();
    const router = new ProbeRouter(dispatcher, executor);

    const result = await router.execute('cloudflare.zones.list', undefined, 'some-agent');

    expect(executor.executeProbe).toHaveBeenCalledWith('cloudflare.zones.list', undefined);
    expect(dispatcher.sendProbe).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
  });
});
