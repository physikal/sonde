import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Auth helpers ---

/** Build Datadog auth headers: DD-API-KEY + DD-APPLICATION-KEY */
function buildAuthHeaders(credentials: IntegrationCredentials): Record<string, string> {
  const apiKey = credentials.credentials.apiKey ?? '';
  const appKey = credentials.credentials.appKey ?? '';
  return {
    'DD-API-KEY': apiKey,
    'DD-APPLICATION-KEY': appKey,
  };
}

// --- REST helper ---

async function datadogGet<T>(
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
    throw new Error(`Datadog API returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// --- Probe handlers ---

const monitorsList: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const queryParams: Record<string, string> = {};
  const tags = params?.tags as string | undefined;
  if (tags) queryParams.tags = tags;

  const monitors = await datadogGet<
    Array<{
      id: number;
      name: string;
      type: string;
      overall_state: string;
      tags?: string[];
      message?: string;
    }>
  >('/api/v1/monitor', config, credentials, fetchFn, queryParams);

  return {
    monitors: monitors.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      overallState: m.overall_state,
      tags: m.tags ?? [],
    })),
    count: monitors.length,
  };
};

const monitorsTriggered: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const monitors = await datadogGet<
    Array<{
      id: number;
      name: string;
      type: string;
      overall_state: string;
      tags?: string[];
    }>
  >('/api/v1/monitor', config, credentials, fetchFn);

  const triggered = monitors.filter(
    (m) => m.overall_state === 'Alert' ||
      m.overall_state === 'Warn' ||
      m.overall_state === 'No Data',
  );

  return {
    monitors: triggered.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      overallState: m.overall_state,
      tags: m.tags ?? [],
    })),
    count: triggered.length,
  };
};

const hostsList: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = await datadogGet<{
    host_list?: Array<{
      name: string;
      id: number;
      up?: boolean;
      is_muted?: boolean;
      apps?: string[];
      meta?: { platform?: string };
    }>;
    total_matching?: number;
  }>('/api/v1/hosts', config, credentials, fetchFn);

  const hosts = data.host_list ?? [];
  return {
    hosts: hosts.map((h) => ({
      name: h.name,
      id: h.id,
      up: h.up ?? false,
      isMuted: h.is_muted ?? false,
      apps: h.apps ?? [],
      platform: h.meta?.platform ?? null,
    })),
    count: data.total_matching ?? hosts.length,
  };
};

const eventsList: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const hours = (params?.hours as number) || 24;
  const now = Math.floor(Date.now() / 1000);
  const start = now - hours * 3600;

  const queryParams: Record<string, string> = {
    'filter[from]': String(start),
    'filter[to]': String(now),
  };
  const query = params?.query as string | undefined;
  if (query) queryParams['filter[query]'] = query;

  const data = await datadogGet<{
    data?: Array<{
      id?: string;
      attributes?: {
        title?: string;
        message?: string;
        timestamp?: string;
        tags?: string[];
        status?: string;
      };
    }>;
  }>('/api/v2/events', config, credentials, fetchFn, queryParams);

  const events = data.data ?? [];
  return {
    events: events.map((e) => ({
      id: e.id ?? null,
      title: e.attributes?.title ?? null,
      message: e.attributes?.message ?? null,
      timestamp: e.attributes?.timestamp ?? null,
      tags: e.attributes?.tags ?? [],
      status: e.attributes?.status ?? null,
    })),
    count: events.length,
  };
};

const datadogHealth: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = await datadogGet<{ valid?: boolean }>(
    '/api/v1/validate',
    config,
    credentials,
    fetchFn,
  );

  return { valid: data.valid ?? false };
};

// --- Pack definition ---

export const datadogPack: IntegrationPack = {
  manifest: {
    name: 'datadog',
    type: 'integration',
    version: '0.1.0',
    description: 'Datadog — monitors, hosts, events, and API health',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'monitors.list',
        description: 'List monitors with status and tags',
        capability: 'observe',
        params: {
          tags: {
            type: 'string',
            description: 'Comma-separated tags to filter monitors',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'monitors.triggered',
        description: 'List monitors in Alert, Warn, or No Data state',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'hosts.list',
        description: 'List infrastructure hosts with status',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'events.list',
        description: 'List recent events with optional query filter',
        capability: 'observe',
        params: {
          query: {
            type: 'string',
            description: 'Event search query',
            required: false,
          },
          hours: {
            type: 'number',
            description: 'Hours to look back (default: 24)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'health',
        description: 'Validate API key connectivity',
        capability: 'observe',
        params: {},
        timeout: 10000,
      },
    ],
    runbook: {
      category: 'observability',
      probes: ['health', 'monitors.triggered'],
      parallel: true,
    },
  },

  handlers: {
    'monitors.list': monitorsList,
    'monitors.triggered': monitorsTriggered,
    'hosts.list': hostsList,
    'events.list': eventsList,
    health: datadogHealth,
  },

  testConnection: async (config, credentials, fetchFn) => {
    const url = `${config.endpoint.replace(/\/$/, '')}/api/v1/validate`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...buildAuthHeaders(credentials),
      ...config.headers,
    };

    const res = await fetchFn(url, { headers });
    return res.ok;
  },
};
