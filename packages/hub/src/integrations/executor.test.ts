import { describe, expect, it, vi } from 'vitest';
import { IntegrationExecutor } from './executor.js';
import type { IntegrationConfig, IntegrationCredentials, IntegrationPack } from './types.js';

function createTestPack(overrides?: {
  handlers?: Record<string, (...args: unknown[]) => Promise<unknown>>;
}): IntegrationPack {
  return {
    manifest: {
      name: 'testapi',
      type: 'integration',
      version: '0.1.0',
      description: 'Test integration',
      requires: { groups: [], files: [], commands: [] },
      probes: [
        { name: 'zones.list', description: 'List zones', capability: 'observe', timeout: 5000 },
        { name: 'dns.records', description: 'DNS records', capability: 'observe', timeout: 5000 },
      ],
    },
    handlers: overrides?.handlers ?? {
      'zones.list': vi.fn().mockResolvedValue({ zones: ['example.com'] }),
      'dns.records': vi.fn().mockResolvedValue({ records: [] }),
    },
    testConnection: vi.fn().mockResolvedValue(true),
  };
}

const testConfig: IntegrationConfig = {
  endpoint: 'https://api.test.com',
};

const testCredentials: IntegrationCredentials = {
  packName: 'testapi',
  authMethod: 'api_key',
  credentials: { apiKey: 'test-key-123' },
};

describe('IntegrationExecutor', () => {
  it('executes a probe via mock fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const executor = new IntegrationExecutor(mockFetch);
    const pack = createTestPack();
    executor.registerPack(pack, testConfig, testCredentials);

    const result = await executor.executeProbe('testapi.zones.list');

    expect(result.status).toBe('success');
    expect(result.data).toEqual({ zones: ['example.com'] });
    expect(result.metadata.agentVersion).toBe('hub');
    expect(result.metadata.packName).toBe('testapi');
  });

  it('returns error for unknown pack', async () => {
    const executor = new IntegrationExecutor(vi.fn());

    const result = await executor.executeProbe('unknown.probe');

    expect(result.status).toBe('error');
  });

  it('returns error for unknown probe in registered pack', async () => {
    const executor = new IntegrationExecutor(vi.fn());
    executor.registerPack(createTestPack(), testConfig, testCredentials);

    const result = await executor.executeProbe('testapi.nonexistent.probe');

    expect(result.status).toBe('error');
  });

  it('retries on 5xx errors', async () => {
    let callCount = 0;
    const handler = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        const response = new Response('Server Error', { status: 500 });
        throw response;
      }
      return { ok: true };
    });

    const executor = new IntegrationExecutor(vi.fn());
    executor.registerPack(
      createTestPack({ handlers: { 'zones.list': handler } }),
      testConfig,
      testCredentials,
    );

    const result = await executor.executeProbe('testapi.zones.list');

    expect(result.status).toBe('success');
    expect(callCount).toBe(3);
  });

  it('times out probe execution', async () => {
    const handler = vi
      .fn()
      .mockImplementation(
        async (_params: unknown, _config: unknown, _creds: unknown, fetchFn: typeof fetch) => {
          // The abort signal will be on the fetchFn — simulate a long-running call
          // by making a fetch that takes too long. We mock the fetch to delay.
          await fetchFn('https://api.test.com/slow');
        },
      );

    const slowFetch = vi
      .fn()
      .mockImplementation((_input: unknown, init?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          const onAbort = () =>
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          if (init?.signal?.aborted) {
            onAbort();
            return;
          }
          init?.signal?.addEventListener('abort', onAbort);
        });
      });

    const executor = new IntegrationExecutor(slowFetch);
    // Register pack with very short timeout
    const pack = createTestPack({ handlers: { 'zones.list': handler } });
    pack.manifest.probes[0]!.timeout = 50;
    executor.registerPack(pack, testConfig, testCredentials);

    const result = await executor.executeProbe('testapi.zones.list');

    expect(result.status).toBe('error');
  });

  it('attempts OAuth2 token refresh on 401', async () => {
    let callCount = 0;
    const handler = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        const response = new Response('Unauthorized', { status: 401 });
        throw response;
      }
      return { refreshed: true };
    });

    const refreshFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'new-token', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const executor = new IntegrationExecutor(refreshFetch);
    const oauthCredentials: IntegrationCredentials = {
      packName: 'testapi',
      authMethod: 'oauth2',
      credentials: {},
      oauth2: {
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        tokenUrl: 'https://auth.test.com/token',
      },
    };

    executor.registerPack(
      createTestPack({ handlers: { 'zones.list': handler } }),
      testConfig,
      oauthCredentials,
    );

    const result = await executor.executeProbe('testapi.zones.list');

    expect(result.status).toBe('success');
    expect(result.data).toEqual({ refreshed: true });
    expect(oauthCredentials.oauth2?.accessToken).toBe('new-token');
  });

  it('isIntegrationProbe returns correct values', () => {
    const executor = new IntegrationExecutor(vi.fn());
    executor.registerPack(createTestPack(), testConfig, testCredentials);

    expect(executor.isIntegrationProbe('testapi.zones.list')).toBe(true);
    expect(executor.isIntegrationProbe('system.disk.usage')).toBe(false);
  });

  it('getRegisteredPacks returns all packs', () => {
    const executor = new IntegrationExecutor(vi.fn());
    const pack = createTestPack();
    executor.registerPack(pack, testConfig, testCredentials);

    const packs = executor.getRegisteredPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0]!.manifest.name).toBe('testapi');
  });

  it('passes params to handler', async () => {
    const handler = vi.fn().mockResolvedValue({ filtered: true });
    const executor = new IntegrationExecutor(vi.fn());
    executor.registerPack(
      createTestPack({ handlers: { 'zones.list': handler } }),
      testConfig,
      testCredentials,
    );

    await executor.executeProbe('testapi.zones.list', { zoneId: 'abc' });

    expect(handler).toHaveBeenCalledWith(
      { zoneId: 'abc' },
      testConfig,
      testCredentials,
      expect.any(Function),
    );
  });
});
