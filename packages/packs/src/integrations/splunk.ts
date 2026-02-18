import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Auth helpers ---

/** Build auth headers: Bearer token or Basic username:password */
export function buildAuthHeaders(credentials: IntegrationCredentials): Record<string, string> {
  if (credentials.authMethod === 'bearer_token') {
    const token = credentials.credentials.splunkToken ?? '';
    return { Authorization: `Bearer ${token}` };
  }

  // basic auth
  const { username, password } = credentials.credentials;
  if (username && password) {
    return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
  }
  return {};
}

// --- Splunk REST helper ---

/** Build a full Splunk REST URL with output_mode=json */
function splunkUrl(endpoint: string, path: string, params?: Record<string, string>): string {
  const base = `${endpoint.replace(/\/$/, '')}${path}`;
  const url = new URL(base);
  url.searchParams.set('output_mode', 'json');
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/** GET a Splunk REST endpoint, returns parsed JSON */
export async function splunkGet(
  path: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
  params?: Record<string, string>,
): Promise<unknown> {
  const url = splunkUrl(config.endpoint, path, params);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...buildAuthHeaders(credentials),
    ...config.headers,
  };

  const res = await fetchFn(url, { headers });
  if (!res.ok) throw new Error(`Splunk API returned ${res.status}: ${res.statusText}`);
  return res.json();
}

/** POST URL-encoded form data to a Splunk REST endpoint, returns parsed JSON */
export async function splunkPost(
  path: string,
  formData: Record<string, string>,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<unknown> {
  const url = splunkUrl(config.endpoint, path);
  const body = new URLSearchParams(formData);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    ...buildAuthHeaders(credentials),
    ...config.headers,
  };

  const res = await fetchFn(url, { method: 'POST', headers, body: body.toString() });
  if (!res.ok) throw new Error(`Splunk API returned ${res.status}: ${res.statusText}`);
  return res.json();
}

// --- Probe handlers ---

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 60;

const splunkSearch: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const query = (params?.query as string) ?? '';
  if (!query) throw new Error('query parameter is required (SPL search string)');

  const earliest = (params?.earliest as string) || '-24h';
  const latest = (params?.latest as string) || 'now';
  const maxResults = (params?.max_results as number) || 100;

  const startTime = Date.now();

  // Create async search job via v2 API
  const jobResponse = (await splunkPost(
    '/services/search/v2/jobs',
    {
      search: query,
      earliest_time: earliest,
      latest_time: latest,
    },
    config,
    credentials,
    fetchFn,
  )) as { sid?: string };

  const sid = jobResponse.sid;
  if (!sid) throw new Error('Splunk did not return a search job ID (sid)');

  // Poll until done
  let dispatchState = '';
  let attempts = 0;

  while (dispatchState !== 'DONE' && attempts < MAX_POLL_ATTEMPTS) {
    const status = (await splunkGet(
      `/services/search/v2/jobs/${sid}`,
      config,
      credentials,
      fetchFn,
    )) as { entry?: Array<{ content?: { dispatchState?: string } }> };

    dispatchState = status.entry?.[0]?.content?.dispatchState ?? '';

    if (dispatchState === 'FAILED') {
      throw new Error('Splunk search job failed');
    }

    if (dispatchState !== 'DONE') {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      attempts++;
    }
  }

  if (dispatchState !== 'DONE') {
    throw new Error('Splunk search job timed out waiting for completion');
  }

  // Fetch results
  const results = (await splunkGet(
    `/services/search/v2/jobs/${sid}/results`,
    config,
    credentials,
    fetchFn,
    { count: String(maxResults) },
  )) as { results?: unknown[]; init_offset?: number; post_process_count?: number };

  const executionTimeMs = Date.now() - startTime;

  return {
    results: results.results ?? [],
    resultCount: (results.results ?? []).length,
    sid,
    executionTimeMs,
  };
};

const splunkIndexes: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = (await splunkGet('/services/data/indexes', config, credentials, fetchFn, {
    count: '0',
  })) as {
    entry?: Array<{
      name?: string;
      content?: {
        currentDBSizeMB?: number;
        totalEventCount?: string;
        minTime?: string;
        maxTime?: string;
        disabled?: boolean;
      };
    }>;
  };

  const indexes = (data.entry ?? []).map((entry) => ({
    name: entry.name ?? '',
    currentSizeMB: entry.content?.currentDBSizeMB ?? 0,
    totalEventCount: entry.content?.totalEventCount ?? '0',
    earliestEventTime: entry.content?.minTime ?? null,
    latestEventTime: entry.content?.maxTime ?? null,
    disabled: entry.content?.disabled ?? false,
  }));

  return { indexes, count: indexes.length };
};

const splunkSavedSearches: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const filterName = params?.name as string | undefined;

  const data = (await splunkGet('/services/saved/searches', config, credentials, fetchFn, {
    count: '0',
  })) as {
    entry?: Array<{
      name?: string;
      content?: {
        search?: string;
        cron_schedule?: string;
        'dispatch.latest_time'?: string;
        disabled?: boolean;
        triggered_alert_count?: number;
      };
      updated?: string;
    }>;
  };

  let searches = (data.entry ?? []).map((entry) => ({
    name: entry.name ?? '',
    search: entry.content?.search ?? '',
    cronSchedule: entry.content?.cron_schedule ?? null,
    disabled: entry.content?.disabled ?? false,
    triggeredAlertCount: entry.content?.triggered_alert_count ?? 0,
    lastUpdated: entry.updated ?? null,
  }));

  if (filterName) {
    const lower = filterName.toLowerCase();
    searches = searches.filter((s) => s.name.toLowerCase().includes(lower));
  }

  return { savedSearches: searches, count: searches.length };
};

const splunkHealth: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = (await splunkGet(
    '/services/server/health/splunkd',
    config,
    credentials,
    fetchFn,
  )) as {
    entry?: Array<{
      content?: {
        health?: string;
        features?: Record<string, { health?: string; [key: string]: unknown }>;
      };
    }>;
  };

  const content = data.entry?.[0]?.content;
  const features = content?.features ?? {};

  const featureHealth = Object.entries(features).map(([name, info]) => ({
    name,
    health: info.health ?? 'unknown',
  }));

  return {
    overallHealth: content?.health ?? 'unknown',
    features: featureHealth,
  };
};

// --- Pack definition ---

export const splunkPack: IntegrationPack = {
  manifest: {
    name: 'splunk',
    type: 'integration',
    version: '0.1.0',
    description: 'Splunk Enterprise — search, indexes, saved searches, and health monitoring',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'search',
        description:
          'Run an SPL search query and return results. Requires a role with "search" capability.',
        capability: 'observe',
        params: {
          query: {
            type: 'string',
            description: 'SPL search query (e.g. "search index=main error | head 10")',
            required: true,
          },
          earliest: {
            type: 'string',
            description: 'Earliest time (default: "-24h")',
            required: false,
          },
          latest: {
            type: 'string',
            description: 'Latest time (default: "now")',
            required: false,
          },
          max_results: {
            type: 'number',
            description: 'Maximum results to return (default: 100)',
            required: false,
          },
        },
        timeout: 60000,
      },
      {
        name: 'indexes',
        description: 'List all indexes with size, event count, and time range',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'saved_searches',
        description: 'List saved searches with schedule and status',
        capability: 'observe',
        params: {
          name: {
            type: 'string',
            description: 'Optional name filter (case-insensitive substring match)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'health',
        description: 'Splunkd health status with per-feature breakdown',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
    ],
    runbook: {
      category: 'observability',
      probes: ['health', 'indexes'],
      parallel: true,
    },
  },

  handlers: {
    search: splunkSearch,
    indexes: splunkIndexes,
    saved_searches: splunkSavedSearches,
    health: splunkHealth,
  },

  testConnection: async (config, credentials, fetchFn) => {
    try {
      const url = splunkUrl(config.endpoint, '/services/server/info');
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...buildAuthHeaders(credentials),
        ...config.headers,
      };

      const res = await fetchFn(url, { headers });
      return res.ok;
    } catch {
      return false;
    }
  },
};
