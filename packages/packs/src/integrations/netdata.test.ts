import type { IntegrationConfig, IntegrationCredentials } from '@sonde/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildAuthHeaders, netdataGet, netdataPack } from './netdata.js';

const netdataConfig: IntegrationConfig = {
  endpoint: 'https://app.netdata.cloud',
};

const tokenCreds: IntegrationCredentials = {
  packName: 'netdata',
  authMethod: 'bearer_token',
  credentials: { token: 'nd-api-token-abc123' },
};

const handler = (name: string) => {
  const h = netdataPack.handlers[name];
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

describe('netdata pack', () => {
  describe('auth headers', () => {
    it('uses Bearer token', () => {
      const headers = buildAuthHeaders(tokenCreds);
      expect(headers.Authorization).toBe('Bearer nd-api-token-abc123');
    });

    it('returns empty token when credentials are missing', () => {
      const emptyCreds: IntegrationCredentials = {
        packName: 'netdata',
        authMethod: 'bearer_token',
        credentials: {},
      };
      const headers = buildAuthHeaders(emptyCreds);
      expect(headers.Authorization).toBe('Bearer ');
    });
  });

  describe('netdataGet', () => {
    it('sends Accept and Authorization headers', async () => {
      const fetchFn = mockResponse([]);
      await netdataGet('/api/v2/nodes', netdataConfig, tokenCreds, fetchFn);

      const [url, init] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/v2/nodes');
      const headers = (init as { headers: Record<string, string> }).headers;
      expect(headers.Accept).toBe('application/json');
      expect(headers.Authorization).toBe('Bearer nd-api-token-abc123');
    });

    it('strips trailing slash from endpoint', async () => {
      const trailingConfig: IntegrationConfig = {
        endpoint: 'https://app.netdata.cloud/',
      };
      const fetchFn = mockResponse([]);
      await netdataGet('/api/v2/nodes', trailingConfig, tokenCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('https://app.netdata.cloud/api/v2/nodes');
      expect(url).not.toContain('//api');
    });

    it('throws on non-200 response', async () => {
      const fetchFn = mockFetchError(401);
      await expect(
        netdataGet('/api/v2/nodes', netdataConfig, tokenCreds, fetchFn),
      ).rejects.toThrow('Netdata API returned 401');
    });
  });

  describe('nodes.list', () => {
    it('returns all nodes', async () => {
      const fetchFn = mockResponse([
        { nd: 'id-1', nm: 'web-01', hostname: 'web-01.local', status: 'Live' },
        { nd: 'id-2', nm: 'db-01', hostname: 'db-01.local', status: 'Offline' },
      ]);

      const result = (await handler('nodes.list')({}, netdataConfig, tokenCreds, fetchFn)) as {
        nodes: Array<{ name: string; status: string; id: string }>;
        count: number;
      };

      expect(result.count).toBe(2);
      expect(result.nodes[0]?.name).toBe('web-01');
      expect(result.nodes[0]?.status).toBe('Live');
      expect(result.nodes[1]?.status).toBe('Offline');
    });

    it('handles empty response', async () => {
      const fetchFn = mockResponse([]);
      const result = (await handler('nodes.list')({}, netdataConfig, tokenCreds, fetchFn)) as {
        nodes: unknown[];
        count: number;
      };

      expect(result.count).toBe(0);
      expect(result.nodes).toHaveLength(0);
    });
  });

  describe('nodes.status', () => {
    it('returns matching node by name', async () => {
      const fetchFn = mockResponse([
        { nd: 'id-1', nm: 'web-01', hostname: 'web-01.local', status: 'Live' },
        { nd: 'id-2', nm: 'db-01', hostname: 'db-01.local', status: 'Offline' },
      ]);

      const result = (await handler('nodes.status')(
        { name: 'web-01' },
        netdataConfig,
        tokenCreds,
        fetchFn,
      )) as { found: boolean; name: string; status: string };

      expect(result.found).toBe(true);
      expect(result.name).toBe('web-01');
      expect(result.status).toBe('Live');
    });

    it('is case-insensitive', async () => {
      const fetchFn = mockResponse([
        { nd: 'id-1', nm: 'Web-01', hostname: 'web-01.local', status: 'Live' },
      ]);

      const result = (await handler('nodes.status')(
        { name: 'WEB-01' },
        netdataConfig,
        tokenCreds,
        fetchFn,
      )) as { found: boolean };

      expect(result.found).toBe(true);
    });

    it('returns found=false when node not found', async () => {
      const fetchFn = mockResponse([
        { nd: 'id-1', nm: 'web-01', hostname: 'web-01.local', status: 'Live' },
      ]);

      const result = (await handler('nodes.status')(
        { name: 'nonexistent' },
        netdataConfig,
        tokenCreds,
        fetchFn,
      )) as { found: boolean; name: string };

      expect(result.found).toBe(false);
      expect(result.name).toBe('nonexistent');
    });

    it('throws when name param is missing', async () => {
      const fetchFn = mockResponse([]);
      await expect(
        handler('nodes.status')({}, netdataConfig, tokenCreds, fetchFn),
      ).rejects.toThrow('name parameter is required');
    });
  });

  describe('alarms.active', () => {
    it('returns active alarms', async () => {
      const fetchFn = mockResponse([
        { nm: 'cpu_usage', status: 'critical', nd_nm: 'web-01', value: 95.2 },
        { nm: 'disk_space', status: 'warning', nd_nm: 'db-01', value: 88.0 },
      ]);

      const result = (await handler('alarms.active')(
        {},
        netdataConfig,
        tokenCreds,
        fetchFn,
      )) as {
        alarms: Array<{ name: string; status: string; node: string; value: number }>;
        count: number;
      };

      expect(result.count).toBe(2);
      expect(result.alarms[0]?.name).toBe('cpu_usage');
      expect(result.alarms[0]?.status).toBe('critical');
      expect(result.alarms[0]?.node).toBe('web-01');
      expect(result.alarms[0]?.value).toBe(95.2);
    });
  });

  describe('spaces.list', () => {
    it('returns spaces', async () => {
      const fetchFn = mockResponse([
        { id: 'sp-1', name: 'Production', slug: 'production' },
        { id: 'sp-2', name: 'Staging', slug: 'staging' },
      ]);

      const result = (await handler('spaces.list')(
        {},
        netdataConfig,
        tokenCreds,
        fetchFn,
      )) as {
        spaces: Array<{ id: string; name: string; slug: string }>;
        count: number;
      };

      expect(result.count).toBe(2);
      expect(result.spaces[0]?.name).toBe('Production');
      expect(result.spaces[1]?.slug).toBe('staging');
    });
  });

  describe('health', () => {
    it('returns reachable=true on success', async () => {
      const fetchFn = mockResponse([{ id: 'sp-1', name: 'Production' }]);

      const result = (await handler('health')({}, netdataConfig, tokenCreds, fetchFn)) as {
        reachable: boolean;
      };

      expect(result.reachable).toBe(true);
    });

    it('throws on non-200 response', async () => {
      const fetchFn = mockFetchError(403);
      await expect(
        handler('health')({}, netdataConfig, tokenCreds, fetchFn),
      ).rejects.toThrow('Netdata API returned 403');
    });
  });

  describe('testConnection', () => {
    it('returns true when GET /api/v2/spaces succeeds', async () => {
      const fetchFn = mockResponse([{ id: 'sp-1' }]);
      const result = await netdataPack.testConnection(netdataConfig, tokenCreds, fetchFn);
      expect(result).toBe(true);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/v2/spaces');
    });

    it('returns false on non-200', async () => {
      const fetchFn = mockFetchError(401);
      const result = await netdataPack.testConnection(netdataConfig, tokenCreds, fetchFn);
      expect(result).toBe(false);
    });

    it('throws on network error', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(netdataPack.testConnection(netdataConfig, tokenCreds, fetchFn))
        .rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('manifest', () => {
    it('has correct name and probe count', () => {
      expect(netdataPack.manifest.name).toBe('netdata');
      expect(netdataPack.manifest.probes).toHaveLength(5);
    });

    it('all handlers match manifest probes', () => {
      const probeNames = netdataPack.manifest.probes.map((p) => p.name);
      const handlerNames = Object.keys(netdataPack.handlers);
      expect(handlerNames.sort()).toEqual(probeNames.sort());
    });

    it('has correct timeouts', () => {
      const probeMap = new Map(netdataPack.manifest.probes.map((p) => [p.name, p.timeout]));
      expect(probeMap.get('nodes.list')).toBe(15000);
      expect(probeMap.get('nodes.status')).toBe(15000);
      expect(probeMap.get('alarms.active')).toBe(15000);
      expect(probeMap.get('spaces.list')).toBe(15000);
      expect(probeMap.get('health')).toBe(10000);
    });

    it('has observability runbook', () => {
      expect(netdataPack.manifest.runbook).toEqual({
        category: 'observability',
        probes: ['health', 'alarms.active'],
        parallel: true,
      });
    });
  });

  describe('error handling', () => {
    it('throws on non-200 API response for probes', async () => {
      const fetchFn = mockFetchError(403);
      await expect(
        handler('nodes.list')({}, netdataConfig, tokenCreds, fetchFn),
      ).rejects.toThrow('Netdata API returned 403');
    });
  });
});
