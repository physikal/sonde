import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Auth helper ---

function buildAuthHeaders(
  credentials: IntegrationCredentials,
  config: IntegrationConfig,
): Record<string, string> {
  const token = credentials.credentials.apiToken ?? '';
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...config.headers,
  };
}

// --- UniFi Access API helper ---

/** Fetch a UniFi Access API endpoint with bearer token auth */
export async function accessFetch(
  path: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<unknown> {
  const endpoint = config.endpoint.replace(/\/$/, '');
  const url = `${endpoint}/${path}`;
  const headers = buildAuthHeaders(credentials, config);

  const res = await fetchFn(url, { headers });
  if (!res.ok) {
    throw new Error(`UniFi Access API returned ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as { data?: unknown };
  return data.data ?? data;
}

// --- Probe handlers ---

const doors: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const result = (await accessFetch(
    'doors',
    config,
    credentials,
    fetchFn,
  )) as Array<Record<string, unknown>>;

  return {
    doors: result.map((d) => ({
      id: d.id ?? d.unique_id,
      name: d.name,
      status: d.door_guard,
      lockRelay: d.lock_relay_status,
      full_name: d.full_name,
    })),
    count: result.length,
  };
};

const doorLogs: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const doorId = (params?.door_id as string) ?? '';
  if (!doorId) throw new Error('door_id parameter is required');

  const limit = (params?.limit as number) || 50;
  const result = (await accessFetch(
    `doors/${doorId}/logs?limit=${limit}`,
    config,
    credentials,
    fetchFn,
  )) as Array<Record<string, unknown>>;

  return { logs: result, count: result.length, doorId };
};

const accessDevices: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const result = (await accessFetch(
    'devices',
    config,
    credentials,
    fetchFn,
  )) as Array<Record<string, unknown>>;

  return {
    devices: result.map((d) => ({
      id: d.id ?? d.unique_id,
      name: d.name,
      type: d.type ?? d.device_type,
      model: d.model,
      firmware: d.firmware ?? d.firmware_version,
      status: d.status ?? d.adoption_status,
      ip: d.ip,
    })),
    count: result.length,
  };
};

// --- Pack definition ---

export const unifiAccessPack: IntegrationPack = {
  manifest: {
    name: 'unifi-access',
    type: 'integration',
    version: '0.1.0',
    description:
      'Ubiquiti UniFi Access — door status, access logs, reader/hub devices',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'doors',
        description: 'List all doors with name, status, and lock state',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'door.logs',
        description: 'Access event log for a specific door',
        capability: 'observe',
        params: {
          door_id: {
            type: 'string',
            description: 'Door ID',
            required: true,
          },
          limit: {
            type: 'number',
            description: 'Maximum log entries to return (default: 50)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'devices',
        description: 'List access devices (readers, hubs) with status',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
    ],
    runbook: {
      category: 'access-control',
      probes: ['doors', 'devices'],
      parallel: true,
    },
  },

  handlers: {
    doors,
    'door.logs': doorLogs,
    devices: accessDevices,
  },

  testConnection: async (config, credentials, fetchFn) => {
    const endpoint = config.endpoint.replace(/\/$/, '');
    const headers = buildAuthHeaders(credentials, config);

    const res = await fetchFn(`${endpoint}/doors`, { headers });
    return res.ok;
  },
};
