import { httpbinPack } from '@sonde/packs';
import { describe, expect, it, vi } from 'vitest';
import { RunbookEngine } from '../engine/runbooks.js';
import type { AgentDispatcher } from '../ws/dispatcher.js';
import { IntegrationExecutor } from './executor.js';
import { ProbeRouter } from './probe-router.js';
import type { IntegrationConfig, IntegrationCredentials } from './types.js';

const httpbinConfig: IntegrationConfig = { endpoint: 'https://httpbin.org' };
const httpbinCreds: IntegrationCredentials = {
  packName: 'httpbin',
  authMethod: 'api_key',
  credentials: {},
};

function createMockFetch() {
  return vi.fn(async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/ip')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ origin: '10.0.0.1' }),
      } as unknown as Response;
    }
    if (url.includes('/headers')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ headers: { Host: 'httpbin.org' } }),
      } as unknown as Response;
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as unknown as typeof globalThis.fetch;
}

function createMockDispatcher() {
  return {
    sendProbe: vi.fn(async (_agent: string, probe: string) => ({
      probe,
      status: 'success' as const,
      data: { usage: 42 },
      durationMs: 10,
      metadata: {
        agentVersion: '0.1.0',
        packName: 'system',
        packVersion: '0.1.0',
        capabilityLevel: 'observe' as const,
      },
    })),
    isAgentOnline: vi.fn(() => true),
    getOnlineAgentIds: vi.fn(() => ['agent-1']),
  } as unknown as AgentDispatcher;
}

describe('mixed routing: agent + integration probes', () => {
  it('routes agent probes to dispatcher and integration probes to executor', async () => {
    const mockFetch = createMockFetch();
    const executor = new IntegrationExecutor(mockFetch);
    executor.registerPack(httpbinPack, httpbinConfig, httpbinCreds);

    const dispatcher = createMockDispatcher();
    const router = new ProbeRouter(dispatcher, executor);

    // Agent probe — requires agent name, routes to dispatcher
    const agentResult = await router.execute('system.cpu.usage', undefined, 'test-server');
    expect(agentResult.status).toBe('success');
    expect(agentResult.data).toEqual({ usage: 42 });
    expect(dispatcher.sendProbe).toHaveBeenCalledWith('test-server', 'system.cpu.usage', undefined);

    // Integration probe — no agent needed, routes to executor
    const integrationResult = await router.execute('httpbin.ip');
    expect(integrationResult.status).toBe('success');
    expect(integrationResult.data).toEqual({ origin: '10.0.0.1' });

    // Dispatcher should only have been called once (for the agent probe)
    expect(dispatcher.sendProbe).toHaveBeenCalledTimes(1);
  });

  it('executes httpbin runbook through RunbookEngine + ProbeRouter', async () => {
    const mockFetch = createMockFetch();
    const executor = new IntegrationExecutor(mockFetch);
    executor.registerPack(httpbinPack, httpbinConfig, httpbinCreds);

    const dispatcher = createMockDispatcher();
    const router = new ProbeRouter(dispatcher, executor);

    const engine = new RunbookEngine();
    engine.loadFromManifests([httpbinPack.manifest]);

    // Run the httpbin runbook — no agent needed for integration probes
    const result = await engine.execute('httpbin', undefined, router);

    expect(result.category).toBe('httpbin');
    expect(result.summary.probesRun).toBe(2); // ip + headers
    expect(result.summary.probesSucceeded).toBe(2);
    expect(result.summary.probesFailed).toBe(0);

    // Verify individual probe results
    // biome-ignore lint/style/noNonNullAssertion: test assertion after verifying probes ran
    expect(result.findings['httpbin.ip']!.status).toBe('success');
    // biome-ignore lint/style/noNonNullAssertion: test assertion after verifying probes ran
    expect(result.findings['httpbin.ip']!.data).toEqual({ origin: '10.0.0.1' });
    // biome-ignore lint/style/noNonNullAssertion: test assertion after verifying probes ran
    expect(result.findings['httpbin.headers']!.status).toBe('success');
    // biome-ignore lint/style/noNonNullAssertion: test assertion after verifying probes ran
    expect(result.findings['httpbin.headers']!.data).toEqual({ headers: { Host: 'httpbin.org' } });

    // Dispatcher should NOT have been called — all probes are integration probes
    expect(dispatcher.sendProbe).not.toHaveBeenCalled();
  });
});
