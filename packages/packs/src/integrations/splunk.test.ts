import type { IntegrationConfig, IntegrationCredentials } from '@sonde/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildAuthHeaders, splunkGet, splunkPack, splunkPost } from './splunk.js';

const splunkConfig: IntegrationConfig = {
  endpoint: 'https://splunk.company.com:8089',
};

const tokenCreds: IntegrationCredentials = {
  packName: 'splunk',
  authMethod: 'bearer_token',
  credentials: { splunkToken: 'my-splunk-token-abc' },
};

const basicCreds: IntegrationCredentials = {
  packName: 'splunk',
  authMethod: 'api_key',
  credentials: { username: 'sonde_svc', password: 'secret123' },
};

const handler = (name: string) => {
  const h = splunkPack.handlers[name];
  if (!h) throw new Error(`Handler ${name} not found`);
  return h;
};

function callArgs(fn: ReturnType<typeof vi.fn>, index: number): unknown[] {
  const args = fn.mock.calls[index];
  if (!args) throw new Error(`No call at index ${index}`);
  return args;
}

/** Mock a Splunk JSON response */
function mockSplunkResponse(body: unknown, status = 200) {
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

describe('splunk pack', () => {
  describe('auth headers', () => {
    it('uses Bearer token for token auth', () => {
      const headers = buildAuthHeaders(tokenCreds);
      expect(headers.Authorization).toBe('Bearer my-splunk-token-abc');
    });

    it('uses Basic auth for username:password', () => {
      const headers = buildAuthHeaders(basicCreds);
      const expected = `Basic ${Buffer.from('sonde_svc:secret123').toString('base64')}`;
      expect(headers.Authorization).toBe(expected);
    });

    it('returns empty headers when credentials are missing', () => {
      const emptyCreds: IntegrationCredentials = {
        packName: 'splunk',
        authMethod: 'api_key',
        credentials: {},
      };
      const headers = buildAuthHeaders(emptyCreds);
      expect(headers.Authorization).toBeUndefined();
    });
  });

  describe('splunkGet', () => {
    it('appends output_mode=json to all requests', async () => {
      const fetchFn = mockSplunkResponse({ entry: [] });
      await splunkGet('/services/server/info', splunkConfig, tokenCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('output_mode=json');
      expect(url).toContain('/services/server/info');
    });

    it('throws on non-200 response', async () => {
      const fetchFn = mockFetchError(401);
      await expect(
        splunkGet('/services/server/info', splunkConfig, tokenCreds, fetchFn),
      ).rejects.toThrow('Splunk API returned 401');
    });
  });

  describe('splunkPost', () => {
    it('sends URL-encoded form data with output_mode=json', async () => {
      const fetchFn = mockSplunkResponse({ sid: 'job-123' });
      await splunkPost(
        '/services/search/v2/jobs',
        { search: 'index=main | head 10', earliest_time: '-1h' },
        splunkConfig,
        tokenCreds,
        fetchFn,
      );

      const [url, init] = callArgs(fetchFn, 0);
      expect(url).toContain('output_mode=json');
      expect((init as { method: string }).method).toBe('POST');
      expect((init as { headers: Record<string, string> }).headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      );
      const body = (init as { body: string }).body;
      expect(body).toContain('search=');
      expect(body).toContain('earliest_time=');
    });

    it('throws on non-200 response', async () => {
      const fetchFn = mockFetchError(403);
      await expect(
        splunkPost(
          '/services/search/v2/jobs',
          { search: 'index=main' },
          splunkConfig,
          tokenCreds,
          fetchFn,
        ),
      ).rejects.toThrow('Splunk API returned 403');
    });
  });

  describe('testConnection', () => {
    it('returns true when GET /services/server/info succeeds', async () => {
      const fetchFn = mockSplunkResponse({
        entry: [{ content: { serverName: 'splunk-01', version: '9.1.0' } }],
      });
      const result = await splunkPack.testConnection(splunkConfig, tokenCreds, fetchFn);
      expect(result).toBe(true);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/services/server/info');
      expect(url).toContain('output_mode=json');
    });

    it('returns false on non-200', async () => {
      const fetchFn = mockFetchError(401);
      const result = await splunkPack.testConnection(splunkConfig, tokenCreds, fetchFn);
      expect(result).toBe(false);
    });

    it('returns false on network error', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await splunkPack.testConnection(splunkConfig, tokenCreds, fetchFn);
      expect(result).toBe(false);
    });
  });

  describe('search', () => {
    it('creates a job, polls, and fetches results', async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // POST create job
          return Promise.resolve(
            new Response(JSON.stringify({ sid: 'job-abc' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        if (callCount === 2) {
          // GET poll — DONE
          return Promise.resolve(
            new Response(
              JSON.stringify({
                entry: [{ content: { dispatchState: 'DONE' } }],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        // GET results
        return Promise.resolve(
          new Response(
            JSON.stringify({
              results: [{ _raw: 'error log line 1' }, { _raw: 'error log line 2' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      const result = (await handler('search')(
        { query: 'search index=main error | head 10', earliest: '-1h', max_results: 50 },
        splunkConfig,
        tokenCreds,
        fetchFn,
      )) as { results: unknown[]; resultCount: number; sid: string; executionTimeMs: number };

      expect(result.sid).toBe('job-abc');
      expect(result.resultCount).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);

      // Verify POST to v2 API
      const [postUrl, postInit] = callArgs(fetchFn, 0);
      expect(postUrl).toContain('/services/search/v2/jobs');
      expect((postInit as { method: string }).method).toBe('POST');
      expect((postInit as { headers: Record<string, string> }).headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      );

      // Verify results fetch includes count param
      const [resultsUrl] = callArgs(fetchFn, 2);
      expect(resultsUrl).toContain('/services/search/v2/jobs/job-abc/results');
      expect(resultsUrl).toContain('count=50');
    });

    it('throws when query is missing', async () => {
      const fetchFn = mockSplunkResponse({});
      await expect(handler('search')({}, splunkConfig, tokenCreds, fetchFn)).rejects.toThrow(
        'query parameter is required',
      );
    });

    it('throws when no sid returned', async () => {
      const fetchFn = mockSplunkResponse({});
      await expect(
        handler('search')({ query: 'search index=main' }, splunkConfig, tokenCreds, fetchFn),
      ).rejects.toThrow('Splunk did not return a search job ID');
    });

    it('throws when search job fails', async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ sid: 'job-fail' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ entry: [{ content: { dispatchState: 'FAILED' } }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });

      await expect(
        handler('search')({ query: 'search index=main' }, splunkConfig, tokenCreds, fetchFn),
      ).rejects.toThrow('Splunk search job failed');
    });
  });

  describe('indexes', () => {
    it('returns index metadata', async () => {
      const fetchFn = mockSplunkResponse({
        entry: [
          {
            name: 'main',
            content: {
              currentDBSizeMB: 1024,
              totalEventCount: '5000000',
              minTime: '2025-01-01T00:00:00Z',
              maxTime: '2026-02-17T12:00:00Z',
              disabled: false,
            },
          },
          {
            name: '_internal',
            content: {
              currentDBSizeMB: 256,
              totalEventCount: '100000',
              minTime: '2025-06-01T00:00:00Z',
              maxTime: '2026-02-17T12:00:00Z',
              disabled: false,
            },
          },
        ],
      });

      const result = (await handler('indexes')({}, splunkConfig, tokenCreds, fetchFn)) as {
        indexes: Array<{ name: string; currentSizeMB: number; totalEventCount: string }>;
        count: number;
      };

      expect(result.count).toBe(2);
      expect(result.indexes[0]?.name).toBe('main');
      expect(result.indexes[0]?.currentSizeMB).toBe(1024);
      expect(result.indexes[0]?.totalEventCount).toBe('5000000');
      expect(result.indexes[1]?.name).toBe('_internal');

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/services/data/indexes');
      expect(url).toContain('count=0');
    });
  });

  describe('saved_searches', () => {
    it('returns saved searches', async () => {
      const fetchFn = mockSplunkResponse({
        entry: [
          {
            name: 'Error Alerts',
            content: {
              search: 'index=main level=error | stats count by host',
              cron_schedule: '*/5 * * * *',
              disabled: false,
              triggered_alert_count: 42,
            },
            updated: '2026-02-17T10:00:00Z',
          },
          {
            name: 'Daily Summary',
            content: {
              search: 'index=main | stats count',
              cron_schedule: '0 0 * * *',
              disabled: true,
              triggered_alert_count: 0,
            },
            updated: '2026-01-01T00:00:00Z',
          },
        ],
      });

      const result = (await handler('saved_searches')({}, splunkConfig, tokenCreds, fetchFn)) as {
        savedSearches: Array<{ name: string; cronSchedule: string | null; disabled: boolean }>;
        count: number;
      };

      expect(result.count).toBe(2);
      expect(result.savedSearches[0]?.name).toBe('Error Alerts');
      expect(result.savedSearches[0]?.cronSchedule).toBe('*/5 * * * *');
      expect(result.savedSearches[1]?.disabled).toBe(true);
    });

    it('filters by name when provided', async () => {
      const fetchFn = mockSplunkResponse({
        entry: [
          {
            name: 'Error Alerts',
            content: { search: 'index=main level=error', disabled: false },
          },
          {
            name: 'Daily Summary',
            content: { search: 'index=main | stats count', disabled: false },
          },
        ],
      });

      const result = (await handler('saved_searches')(
        { name: 'error' },
        splunkConfig,
        tokenCreds,
        fetchFn,
      )) as { savedSearches: Array<{ name: string }>; count: number };

      expect(result.count).toBe(1);
      expect(result.savedSearches[0]?.name).toBe('Error Alerts');
    });
  });

  describe('health', () => {
    it('returns overall health and per-feature breakdown', async () => {
      const fetchFn = mockSplunkResponse({
        entry: [
          {
            content: {
              health: 'green',
              features: {
                'File Monitor Input': { health: 'green' },
                Indexer: { health: 'green' },
                'Search Scheduler': { health: 'yellow' },
              },
            },
          },
        ],
      });

      const result = (await handler('health')({}, splunkConfig, tokenCreds, fetchFn)) as {
        overallHealth: string;
        features: Array<{ name: string; health: string }>;
      };

      expect(result.overallHealth).toBe('green');
      expect(result.features).toHaveLength(3);

      const scheduler = result.features.find((f) => f.name === 'Search Scheduler');
      expect(scheduler?.health).toBe('yellow');
    });

    it('handles missing features gracefully', async () => {
      const fetchFn = mockSplunkResponse({ entry: [{ content: { health: 'red' } }] });

      const result = (await handler('health')({}, splunkConfig, tokenCreds, fetchFn)) as {
        overallHealth: string;
        features: unknown[];
      };

      expect(result.overallHealth).toBe('red');
      expect(result.features).toHaveLength(0);
    });
  });

  describe('manifest', () => {
    it('has correct name and probe count', () => {
      expect(splunkPack.manifest.name).toBe('splunk');
      expect(splunkPack.manifest.probes).toHaveLength(4);
    });

    it('all handlers match manifest probes', () => {
      const probeNames = splunkPack.manifest.probes.map((p) => p.name);
      const handlerNames = Object.keys(splunkPack.handlers);
      expect(handlerNames.sort()).toEqual(probeNames.sort());
    });

    it('has correct timeouts (60s for search, 15s for others)', () => {
      const probeMap = new Map(splunkPack.manifest.probes.map((p) => [p.name, p.timeout]));
      expect(probeMap.get('search')).toBe(60000);
      expect(probeMap.get('indexes')).toBe(15000);
      expect(probeMap.get('saved_searches')).toBe(15000);
      expect(probeMap.get('health')).toBe(15000);
    });

    it('has observability runbook', () => {
      expect(splunkPack.manifest.runbook).toEqual({
        category: 'observability',
        probes: ['health', 'indexes'],
        parallel: true,
      });
    });
  });

  describe('error handling', () => {
    it('throws on non-200 API response for probes', async () => {
      const fetchFn = mockFetchError(403);
      await expect(handler('indexes')({}, splunkConfig, tokenCreds, fetchFn)).rejects.toThrow(
        'Splunk API returned 403',
      );
    });
  });
});
