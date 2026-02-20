import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Paginated response shape from official API ---

interface PagedResponse<T> {
  offset: number;
  limit: number;
  count: number;
  totalCount: number;
  data: T[];
}

// --- API helper ---

/**
 * Fetch a UniFi Network official API endpoint.
 * Auth: X-API-KEY header. Base path: /proxy/network/integration
 * Docs: Settings > Control Plane > Integrations on your controller,
 * or https://developer.ui.com/network/v10.1.84/gettingstarted
 */
export async function unifiFetch<T = unknown>(
  path: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<T> {
  const apiKey = credentials.credentials.apiKey ?? '';
  const endpoint = config.endpoint.replace(/\/$/, '');
  const url = `${endpoint}/proxy/network/integration${path}`;

  const res = await fetchFn(url, {
    headers: {
      'X-API-KEY': apiKey,
      Accept: 'application/json',
      ...config.headers,
    },
  });

  if (!res.ok) {
    throw new Error(
      `UniFi Network API returned ${res.status}: ${res.statusText}`,
    );
  }

  return (await res.json()) as T;
}

/** Collect all pages from a paginated endpoint (max 200 per page) */
async function fetchAllPages<T>(
  path: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
  maxItems = 1000,
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  const limit = 200;

  while (results.length < maxItems) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await unifiFetch<PagedResponse<T>>(
      `${path}${sep}offset=${offset}&limit=${limit}`,
      config,
      credentials,
      fetchFn,
    );
    results.push(...page.data);
    if (results.length >= page.totalCount) break;
    offset += limit;
  }

  return results;
}

/** Resolve the siteId — uses the first site unless overridden */
async function resolveSiteId(
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<string> {
  const explicit = credentials.credentials.siteId ?? '';
  if (explicit) return explicit;

  const sites = await unifiFetch<PagedResponse<{ id: string; name: string }>>(
    '/v1/sites?limit=1',
    config,
    credentials,
    fetchFn,
  );
  const first = sites.data[0];
  if (!first) throw new Error('No sites found on this UniFi controller');
  return first.id;
}

// --- Probe handlers ---

const appInfo: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  return unifiFetch('/v1/info', config, credentials, fetchFn);
};

const sites: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const result = await fetchAllPages<Record<string, unknown>>(
    '/v1/sites',
    config,
    credentials,
    fetchFn,
  );
  return { sites: result, count: result.length };
};

const devices: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const siteId = await resolveSiteId(config, credentials, fetchFn);
  const result = await fetchAllPages<Record<string, unknown>>(
    `/v1/sites/${siteId}/devices`,
    config,
    credentials,
    fetchFn,
  );

  return {
    devices: result.map((d) => ({
      id: d.id,
      macAddress: d.macAddress,
      ipAddress: d.ipAddress,
      name: d.name,
      model: d.model,
      state: d.state,
      firmwareVersion: d.firmwareVersion,
      firmwareUpdatable: d.firmwareUpdatable,
      features: d.features,
    })),
    count: result.length,
  };
};

const deviceDetail: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const deviceId = (params?.device_id as string) ?? '';
  if (!deviceId) {
    throw new Error('device_id parameter is required (device UUID)');
  }

  const siteId = await resolveSiteId(config, credentials, fetchFn);
  return unifiFetch(
    `/v1/sites/${siteId}/devices/${deviceId}`,
    config,
    credentials,
    fetchFn,
  );
};

const deviceStats: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const deviceId = (params?.device_id as string) ?? '';
  if (!deviceId) {
    throw new Error('device_id parameter is required (device UUID)');
  }

  const siteId = await resolveSiteId(config, credentials, fetchFn);
  return unifiFetch(
    `/v1/sites/${siteId}/devices/${deviceId}/statistics/latest`,
    config,
    credentials,
    fetchFn,
  );
};

const clients: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const siteId = await resolveSiteId(config, credentials, fetchFn);
  const result = await fetchAllPages<Record<string, unknown>>(
    `/v1/sites/${siteId}/clients`,
    config,
    credentials,
    fetchFn,
  );

  return {
    clients: result.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      ipAddress: c.ipAddress,
      connectedAt: c.connectedAt,
    })),
    count: result.length,
  };
};

const networks: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const siteId = await resolveSiteId(config, credentials, fetchFn);
  const result = await fetchAllPages<Record<string, unknown>>(
    `/v1/sites/${siteId}/networks`,
    config,
    credentials,
    fetchFn,
  );
  return { networks: result, count: result.length };
};

const wans: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const siteId = await resolveSiteId(config, credentials, fetchFn);
  const result = await fetchAllPages<Record<string, unknown>>(
    `/v1/sites/${siteId}/wans`,
    config,
    credentials,
    fetchFn,
  );
  return { wans: result, count: result.length };
};

// --- Pack definition ---

export const unifiPack: IntegrationPack = {
  manifest: {
    name: 'unifi',
    type: 'integration',
    version: '0.2.0',
    description:
      'Ubiquiti UniFi Network — devices, clients, networks, WAN, device stats (official API)',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'info',
        description: 'Application version and basic info',
        capability: 'observe',
        params: {},
        timeout: 10000,
      },
      {
        name: 'sites',
        description: 'List all sites on this controller',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'devices',
        description:
          'List adopted devices with state, model, firmware, features',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'device.detail',
        description:
          'Full device details including interfaces and uplink',
        capability: 'observe',
        params: {
          device_id: {
            type: 'string',
            description: 'Device UUID',
            required: true,
          },
        },
        timeout: 15000,
      },
      {
        name: 'device.stats',
        description:
          'Latest device statistics — CPU, memory, uptime, load averages',
        capability: 'observe',
        params: {
          device_id: {
            type: 'string',
            description: 'Device UUID',
            required: true,
          },
        },
        timeout: 15000,
      },
      {
        name: 'clients',
        description: 'Connected clients with type, IP, connection time',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'networks',
        description: 'List configured networks (VLANs, etc.)',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'wans',
        description: 'WAN interface definitions',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
    ],
    runbook: {
      category: 'network',
      probes: ['info', 'devices', 'clients'],
      parallel: true,
    },
  },

  handlers: {
    info: appInfo,
    sites,
    devices,
    'device.detail': deviceDetail,
    'device.stats': deviceStats,
    clients,
    networks,
    wans,
  },

  testConnection: async (config, credentials, fetchFn) => {
    const result = await unifiFetch<{ applicationVersion: string }>(
      '/v1/info',
      config,
      credentials,
      fetchFn,
    );
    return typeof result.applicationVersion === 'string';
  },
};
