import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Auth helpers ---

export function buildAuthHeaders(credentials: IntegrationCredentials): Record<string, string> {
  const token = credentials.credentials.token ?? '';
  return { Authorization: `Bearer ${token}` };
}

// --- REST helper ---

export async function netdataGet<T>(
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
    throw new Error(`Netdata API returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// --- Probe handlers ---

const nodesList: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = await netdataGet<
    Array<{
      nd?: string;
      nm?: string;
      hostname?: string;
      status?: string;
    }>
  >('/api/v2/nodes', config, credentials, fetchFn);

  const nodes = Array.isArray(data) ? data : [];
  return {
    nodes: nodes.map((n) => ({
      name: n.nm ?? n.hostname ?? null,
      status: n.status ?? null,
      id: n.nd ?? null,
      hostname: n.hostname ?? null,
    })),
    count: nodes.length,
  };
};

const nodesStatus: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const name = params?.name as string | undefined;
  if (!name) {
    throw new Error('name parameter is required');
  }

  const data = await netdataGet<
    Array<{
      nd?: string;
      nm?: string;
      hostname?: string;
      status?: string;
    }>
  >('/api/v2/nodes', config, credentials, fetchFn);

  const nodes = Array.isArray(data) ? data : [];
  const lowerName = name.toLowerCase();
  const match = nodes.find(
    (n) =>
      (n.nm ?? '').toLowerCase() === lowerName ||
      (n.hostname ?? '').toLowerCase() === lowerName,
  );

  if (!match) {
    return { found: false, name };
  }

  return {
    found: true,
    name: match.nm ?? match.hostname ?? null,
    status: match.status ?? null,
    id: match.nd ?? null,
    hostname: match.hostname ?? null,
  };
};

const alarmsActive: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = await netdataGet<
    Array<{
      nm?: string;
      nd_nm?: string;
      status?: string;
      value?: number;
    }>
  >('/api/v2/alerts', config, credentials, fetchFn);

  const alarms = Array.isArray(data) ? data : [];
  return {
    alarms: alarms.map((a) => ({
      name: a.nm ?? null,
      status: a.status ?? null,
      node: a.nd_nm ?? null,
      value: a.value ?? null,
    })),
    count: alarms.length,
  };
};

const spacesList: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = await netdataGet<
    Array<{
      id?: string;
      name?: string;
      slug?: string;
    }>
  >('/api/v2/spaces', config, credentials, fetchFn);

  const spaces = Array.isArray(data) ? data : [];
  return {
    spaces: spaces.map((s) => ({
      id: s.id ?? null,
      name: s.name ?? null,
      slug: s.slug ?? null,
    })),
    count: spaces.length,
  };
};

const netdataHealth: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  await netdataGet('/api/v2/spaces', config, credentials, fetchFn);
  return { reachable: true };
};

// --- Pack definition ---

export const netdataPack: IntegrationPack = {
  manifest: {
    name: 'netdata',
    type: 'integration',
    version: '0.1.0',
    description: 'Netdata Cloud — node monitoring, alerts, and health',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'nodes.list',
        description: 'List all nodes with status (Live/Stale/Offline)',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'nodes.status',
        description: 'Single node health by name',
        capability: 'observe',
        params: {
          name: {
            type: 'string',
            description: 'Node name to look up',
            required: true,
          },
        },
        timeout: 15000,
      },
      {
        name: 'alarms.active',
        description: 'Active alarms across all nodes',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'spaces.list',
        description: 'List organizational spaces',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'health',
        description: 'Validate API connectivity',
        capability: 'observe',
        params: {},
        timeout: 10000,
      },
    ],
    runbook: {
      category: 'observability',
      probes: ['health', 'alarms.active'],
      parallel: true,
    },
  },

  handlers: {
    'nodes.list': nodesList,
    'nodes.status': nodesStatus,
    'alarms.active': alarmsActive,
    'spaces.list': spacesList,
    health: netdataHealth,
  },

  testConnection: async (config, credentials, fetchFn) => {
    const url = `${config.endpoint.replace(/\/$/, '')}/api/v2/spaces`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...buildAuthHeaders(credentials),
      ...config.headers,
    };

    const res = await fetchFn(url, { headers });
    return res.ok;
  },
};
