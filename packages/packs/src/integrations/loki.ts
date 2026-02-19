import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Auth helpers ---

/** Build auth headers: Basic (username:password) or Bearer token */
function buildAuthHeaders(credentials: IntegrationCredentials): Record<string, string> {
  if (credentials.authMethod === 'bearer_token') {
    const token = credentials.credentials.token ?? '';
    return { Authorization: `Bearer ${token}` };
  }

  const { username, password } = credentials.credentials;
  if (username && password) {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }
  return {};
}

// --- REST helper ---

async function lokiGet<T>(
  path: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
  params?: Record<string, string>,
): Promise<T> {
  const base = `${config.endpoint.replace(/\/$/, '')}${path}`;
  const url = new URL(base);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...buildAuthHeaders(credentials),
    ...config.headers,
  };

  const res = await fetchFn(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`Loki API returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// --- Probe handlers ---

const lokiQuery: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const query = params?.query as string;
  if (!query) throw new Error('query parameter is required (LogQL expression)');

  const limit = (params?.limit as number) || 100;
  const now = Math.floor(Date.now() / 1e9);
  const start = params?.start as string | undefined;
  const end = params?.end as string | undefined;

  const queryParams: Record<string, string> = {
    query,
    limit: String(limit),
    start: start ?? String(now - 3600),
    end: end ?? String(now),
  };

  const data = await lokiGet<{
    status?: string;
    data?: {
      resultType?: string;
      result?: Array<{
        stream?: Record<string, string>;
        values?: Array<[string, string]>;
      }>;
    };
  }>('/loki/api/v1/query_range', config, credentials, fetchFn, queryParams);

  const results = data.data?.result ?? [];
  return {
    status: data.status ?? 'unknown',
    resultType: data.data?.resultType ?? null,
    results: results.map((r) => ({
      stream: r.stream ?? {},
      values: (r.values ?? []).map(([ts, line]) => ({
        timestamp: ts,
        line,
      })),
    })),
    count: results.length,
  };
};

const lokiLabels: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = await lokiGet<{
    status?: string;
    data?: string[];
  }>('/loki/api/v1/labels', config, credentials, fetchFn);

  return {
    labels: data.data ?? [],
    count: (data.data ?? []).length,
  };
};

const lokiSeries: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const match = params?.match as string;
  if (!match) throw new Error('match parameter is required (label selector)');

  const data = await lokiGet<{
    status?: string;
    data?: Array<Record<string, string>>;
  }>('/loki/api/v1/series', config, credentials, fetchFn, { match });

  return {
    series: data.data ?? [],
    count: (data.data ?? []).length,
  };
};

const lokiHealth: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const url = `${config.endpoint.replace(/\/$/, '')}/ready`;
  const headers: Record<string, string> = {
    ...buildAuthHeaders(credentials),
    ...config.headers,
  };

  const res = await fetchFn(url, { headers });
  return { ready: res.ok, status: res.status };
};

// --- Pack definition ---

export const lokiPack: IntegrationPack = {
  manifest: {
    name: 'loki',
    type: 'integration',
    version: '0.1.0',
    description: 'Grafana Loki — LogQL queries, labels, series, and health',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'query',
        description: 'Run a LogQL query over a time range',
        capability: 'observe',
        params: {
          query: {
            type: 'string',
            description: 'LogQL query expression (e.g. {job="varlogs"})',
            required: true,
          },
          start: {
            type: 'string',
            description: 'Start time as Unix epoch seconds (default: 1 hour ago)',
            required: false,
          },
          end: {
            type: 'string',
            description: 'End time as Unix epoch seconds (default: now)',
            required: false,
          },
          limit: {
            type: 'number',
            description: 'Maximum log entries to return (default: 100)',
            required: false,
          },
        },
        timeout: 30000,
      },
      {
        name: 'labels',
        description: 'List all label names',
        capability: 'observe',
        params: {},
        timeout: 10000,
      },
      {
        name: 'series',
        description: 'Find series matching a label selector',
        capability: 'observe',
        params: {
          match: {
            type: 'string',
            description: 'Label selector (e.g. {job="varlogs"})',
            required: true,
          },
        },
        timeout: 15000,
      },
      {
        name: 'health',
        description: 'Loki readiness check',
        capability: 'observe',
        params: {},
        timeout: 5000,
      },
    ],
    runbook: {
      category: 'observability',
      probes: ['health', 'labels'],
      parallel: true,
    },
  },

  handlers: {
    query: lokiQuery,
    labels: lokiLabels,
    series: lokiSeries,
    health: lokiHealth,
  },

  testConnection: async (config, credentials, fetchFn) => {
    const url = `${config.endpoint.replace(/\/$/, '')}/ready`;
    const headers: Record<string, string> = {
      ...buildAuthHeaders(credentials),
      ...config.headers,
    };

    const res = await fetchFn(url, { headers });
    return res.ok;
  },
};
