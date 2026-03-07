import type { IntegrationConfig, IntegrationCredentials } from '@sonde/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildAuthHeaders, kuberoGet, kuberoPack } from './kubero.js';

const kuberoConfig: IntegrationConfig = {
  endpoint: 'https://kubero.company.com',
};

const tokenCreds: IntegrationCredentials = {
  packName: 'kubero',
  authMethod: 'bearer_token',
  credentials: { token: 'my-jwt-token-abc' },
};

const handler = (name: string) => {
  const h = kuberoPack.handlers[name];
  if (!h) throw new Error(`Handler ${name} not found`);
  return h;
};

function callArgs(fn: ReturnType<typeof vi.fn>, index: number): unknown[] {
  const args = fn.mock.calls[index];
  if (!args) throw new Error(`No call at index ${index}`);
  return args;
}

function mockResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function mockFetchError(status: number) {
  return vi.fn().mockResolvedValue(new Response('Error', { status, statusText: 'Error' }));
}

describe('kubero pack', () => {
  describe('auth headers', () => {
    it('uses Bearer token', () => {
      const headers = buildAuthHeaders(tokenCreds);
      expect(headers.Authorization).toBe('Bearer my-jwt-token-abc');
    });

    it('returns empty token when credentials are missing', () => {
      const emptyCreds: IntegrationCredentials = {
        packName: 'kubero',
        authMethod: 'bearer_token',
        credentials: {},
      };
      const headers = buildAuthHeaders(emptyCreds);
      expect(headers.Authorization).toBe('Bearer ');
    });
  });

  describe('kuberoGet', () => {
    it('builds correct URL with path', async () => {
      const fetchFn = mockResponse([]);
      await kuberoGet('/api/apps', kuberoConfig, tokenCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/apps');
      expect(url).toContain('kubero.company.com');
    });

    it('appends query params', async () => {
      const fetchFn = mockResponse([]);
      await kuberoGet('/api/apps', kuberoConfig, tokenCreds, fetchFn, { foo: 'bar' });

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('foo=bar');
    });

    it('throws on non-200 response', async () => {
      const fetchFn = mockFetchError(401);
      await expect(
        kuberoGet('/api/apps', kuberoConfig, tokenCreds, fetchFn),
      ).rejects.toThrow('Kubero API returned 401');
    });
  });

  describe('testConnection', () => {
    it('returns true when GET /api/pipelines succeeds', async () => {
      const fetchFn = mockResponse([]);
      const result = await kuberoPack.testConnection(kuberoConfig, tokenCreds, fetchFn);
      expect(result).toBe(true);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/pipelines');
    });

    it('returns false on non-200', async () => {
      const fetchFn = mockFetchError(401);
      const result = await kuberoPack.testConnection(kuberoConfig, tokenCreds, fetchFn);
      expect(result).toBe(false);
    });

    it('throws on network error', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(kuberoPack.testConnection(kuberoConfig, tokenCreds, fetchFn))
        .rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('apps.list', () => {
    it('returns apps with count', async () => {
      const fetchFn = mockResponse([
        { name: 'web', pipeline: 'main', phase: 'production', status: 'running' },
        { name: 'api', pipeline: 'main', phase: 'staging', status: 'stopped' },
      ]);

      const result = (await handler('apps.list')({}, kuberoConfig, tokenCreds, fetchFn)) as {
        apps: Array<{ name: string; pipeline: string; phase: string; status: string }>;
        count: number;
      };

      expect(result.count).toBe(2);
      expect(result.apps[0]?.name).toBe('web');
      expect(result.apps[0]?.pipeline).toBe('main');
      expect(result.apps[0]?.status).toBe('running');
      expect(result.apps[1]?.name).toBe('api');

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/apps');
    });

    it('handles empty response', async () => {
      const fetchFn = mockResponse([]);

      const result = (await handler('apps.list')({}, kuberoConfig, tokenCreds, fetchFn)) as {
        apps: unknown[];
        count: number;
      };

      expect(result.count).toBe(0);
      expect(result.apps).toHaveLength(0);
    });
  });

  describe('app.detail', () => {
    it('returns app details', async () => {
      const fetchFn = mockResponse({
        name: 'web',
        pipeline: 'main',
        phase: 'production',
        image: { repository: 'ghcr.io/org/web', tag: 'v1.2.3' },
      });

      const result = (await handler('app.detail')(
        { pipeline: 'main', phase: 'production', app: 'web' },
        kuberoConfig,
        tokenCreds,
        fetchFn,
      )) as { name: string; pipeline: string; image: { repository: string } };

      expect(result.name).toBe('web');
      expect(result.image.repository).toBe('ghcr.io/org/web');

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/apps/main/production/web');
    });

    it('throws when pipeline is missing', async () => {
      const fetchFn = mockResponse({});
      await expect(
        handler('app.detail')({ phase: 'production', app: 'web' }, kuberoConfig, tokenCreds, fetchFn),
      ).rejects.toThrow('pipeline, phase, and app parameters are required');
    });

    it('throws when phase is missing', async () => {
      const fetchFn = mockResponse({});
      await expect(
        handler('app.detail')({ pipeline: 'main', app: 'web' }, kuberoConfig, tokenCreds, fetchFn),
      ).rejects.toThrow('pipeline, phase, and app parameters are required');
    });

    it('throws when app is missing', async () => {
      const fetchFn = mockResponse({});
      await expect(
        handler('app.detail')({ pipeline: 'main', phase: 'production' }, kuberoConfig, tokenCreds, fetchFn),
      ).rejects.toThrow('pipeline, phase, and app parameters are required');
    });

    it('encodes path parameters', async () => {
      const fetchFn = mockResponse({});
      await handler('app.detail')(
        { pipeline: 'my pipeline', phase: 'my phase', app: 'my app' },
        kuberoConfig,
        tokenCreds,
        fetchFn,
      );

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/apps/my%20pipeline/my%20phase/my%20app');
    });
  });

  describe('pipelines.list', () => {
    it('returns pipelines with count', async () => {
      const fetchFn = mockResponse([
        { name: 'main', phases: ['staging', 'production'] },
        { name: 'preview', phases: ['review'] },
      ]);

      const result = (await handler('pipelines.list')({}, kuberoConfig, tokenCreds, fetchFn)) as {
        pipelines: Array<{ name: string; phases: string[] }>;
        count: number;
      };

      expect(result.count).toBe(2);
      expect(result.pipelines[0]?.name).toBe('main');
      expect(result.pipelines[0]?.phases).toEqual(['staging', 'production']);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/pipelines');
    });
  });

  describe('pipeline.detail', () => {
    it('returns pipeline details', async () => {
      const fetchFn = mockResponse({
        name: 'main',
        phases: [
          { name: 'staging', enabled: true },
          { name: 'production', enabled: true },
        ],
        git: { repository: 'https://github.com/org/app' },
      });

      const result = (await handler('pipeline.detail')(
        { name: 'main' },
        kuberoConfig,
        tokenCreds,
        fetchFn,
      )) as { name: string; phases: Array<{ name: string }> };

      expect(result.name).toBe('main');
      expect(result.phases).toHaveLength(2);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/pipelines/main');
    });

    it('throws when name is missing', async () => {
      const fetchFn = mockResponse({});
      await expect(
        handler('pipeline.detail')({}, kuberoConfig, tokenCreds, fetchFn),
      ).rejects.toThrow('name parameter is required');
    });
  });

  describe('health', () => {
    it('returns reachable true on success', async () => {
      const fetchFn = mockResponse({ podSizeList: [], clusterIssuer: 'letsencrypt' });

      const result = (await handler('health')({}, kuberoConfig, tokenCreds, fetchFn)) as {
        reachable: boolean;
      };

      expect(result.reachable).toBe(true);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/config');
    });

    it('throws on API error', async () => {
      const fetchFn = mockFetchError(500);
      await expect(
        handler('health')({}, kuberoConfig, tokenCreds, fetchFn),
      ).rejects.toThrow('Kubero API returned 500');
    });
  });

  describe('manifest', () => {
    it('has correct name and probe count', () => {
      expect(kuberoPack.manifest.name).toBe('kubero');
      expect(kuberoPack.manifest.probes).toHaveLength(5);
    });

    it('all handlers match manifest probes', () => {
      const probeNames = kuberoPack.manifest.probes.map((p) => p.name);
      const handlerNames = Object.keys(kuberoPack.handlers);
      expect(handlerNames.sort()).toEqual(probeNames.sort());
    });

    it('has correct timeouts (15s for probes, 10s for health)', () => {
      const probeMap = new Map(kuberoPack.manifest.probes.map((p) => [p.name, p.timeout]));
      expect(probeMap.get('apps.list')).toBe(15000);
      expect(probeMap.get('app.detail')).toBe(15000);
      expect(probeMap.get('pipelines.list')).toBe(15000);
      expect(probeMap.get('pipeline.detail')).toBe(15000);
      expect(probeMap.get('health')).toBe(10000);
    });

    it('has kubero runbook', () => {
      expect(kuberoPack.manifest.runbook).toEqual({
        category: 'kubero',
        probes: ['health', 'apps.list'],
        parallel: true,
      });
    });
  });

  describe('error handling', () => {
    it('throws on non-200 API response for probes', async () => {
      const fetchFn = mockFetchError(403);
      await expect(
        handler('apps.list')({}, kuberoConfig, tokenCreds, fetchFn),
      ).rejects.toThrow('Kubero API returned 403');
    });
  });
});
