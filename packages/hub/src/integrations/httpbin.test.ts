import { httpbinPack } from '@sonde/packs';
import { describe, expect, it, vi } from 'vitest';
import { AgentDispatcher } from '../ws/dispatcher.js';
import { IntegrationExecutor } from './executor.js';
import { ProbeRouter } from './probe-router.js';
import type { IntegrationConfig, IntegrationCredentials } from './types.js';

const testConfig: IntegrationConfig = {
  endpoint: 'https://httpbin.org',
};

const testCredentials: IntegrationCredentials = {
  packName: 'httpbin',
  authMethod: 'api_key',
  credentials: {},
};

function createMockFetch(
  responses: Record<string, { ok: boolean; status: number; body: unknown }>,
) {
  return vi.fn(async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [pattern, response] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        return {
          ok: response.ok,
          status: response.status,
          json: async () => response.body,
        } as unknown as Response;
      }
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as unknown as typeof globalThis.fetch;
}

describe('httpbin integration pack', () => {
  it('executes ip probe and returns structured result', async () => {
    const mockFetch = createMockFetch({
      '/ip': { ok: true, status: 200, body: { origin: '1.2.3.4' } },
    });

    const executor = new IntegrationExecutor(mockFetch);
    executor.registerPack(httpbinPack, testConfig, testCredentials);

    const result = await executor.executeProbe('httpbin.ip');

    expect(result.status).toBe('success');
    expect(result.data).toEqual({ origin: '1.2.3.4' });
    expect(result.metadata.packName).toBe('httpbin');
  });

  it('executes status probe with code param', async () => {
    const mockFetch = createMockFetch({
      '/status/418': { ok: false, status: 418, body: null },
    });

    const executor = new IntegrationExecutor(mockFetch);
    executor.registerPack(httpbinPack, testConfig, testCredentials);

    const result = await executor.executeProbe('httpbin.status', { code: 418 });

    expect(result.status).toBe('success');
    expect(result.data).toEqual({ statusCode: 418, ok: false });
  });

  it('executes headers probe', async () => {
    const mockHeaders = { Host: 'httpbin.org', 'User-Agent': 'node' };
    const mockFetch = createMockFetch({
      '/headers': { ok: true, status: 200, body: { headers: mockHeaders } },
    });

    const executor = new IntegrationExecutor(mockFetch);
    executor.registerPack(httpbinPack, testConfig, testCredentials);

    const result = await executor.executeProbe('httpbin.headers');

    expect(result.status).toBe('success');
    expect(result.data).toEqual({ headers: mockHeaders });
  });

  it('testConnection returns true on success', async () => {
    const mockFetch = createMockFetch({
      '/ip': { ok: true, status: 200, body: { origin: '1.2.3.4' } },
    });

    const ok = await httpbinPack.testConnection(testConfig, testCredentials, mockFetch);

    expect(ok).toBe(true);
  });

  it('testConnection returns false on failure', async () => {
    const mockFetch = createMockFetch({
      '/ip': { ok: false, status: 500, body: null },
    });

    const ok = await httpbinPack.testConnection(testConfig, testCredentials, mockFetch);

    expect(ok).toBe(false);
  });

  it('testConnection throws on network error', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof globalThis.fetch;

    await expect(httpbinPack.testConnection(testConfig, testCredentials, mockFetch))
      .rejects.toThrow('fetch failed');
  });

  it('routes through ProbeRouter for integration probe', async () => {
    const mockFetch = createMockFetch({
      '/ip': { ok: true, status: 200, body: { origin: '10.0.0.1' } },
    });

    const executor = new IntegrationExecutor(mockFetch);
    executor.registerPack(httpbinPack, testConfig, testCredentials);

    const dispatcher = new AgentDispatcher();
    const router = new ProbeRouter(dispatcher, executor);

    // Integration probe — no agent needed
    const result = await router.execute('httpbin.ip');

    expect(result.status).toBe('success');
    expect(result.data).toEqual({ origin: '10.0.0.1' });
  });
});
