import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- API helper ---

/**
 * Fetch a UniFi Access developer API endpoint.
 * Auth: Authorization: Bearer <token>
 * Token generated in UniFi Access > Settings > Developer API.
 * Base path set by user in endpoint config (includes /proxy/access/api/v1/developer
 * when accessed through UDM, or direct on port 12445).
 */
export async function accessFetch<T = unknown>(
  path: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<T> {
  const token = credentials.credentials.apiToken ?? '';
  const endpoint = config.endpoint.replace(/\/$/, '');
  const url = `${endpoint}/${path}`;

  const res = await fetchFn(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...config.headers,
    },
  });

  if (!res.ok) {
    throw new Error(
      `UniFi Access API returned ${res.status}: ${res.statusText}`,
    );
  }

  const body = (await res.json()) as { data?: T };
  return (body.data ?? body) as T;
}

// --- Probe handlers ---

const doors: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const result = await accessFetch<Array<Record<string, unknown>>>(
    'doors',
    config,
    credentials,
    fetchFn,
  );

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

const systemLogs: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const pageSize = (params?.limit as number) || 25;
  const topic = (params?.topic as string) ?? '';

  let path = `system/logs?page_size=${pageSize}`;
  if (topic) path += `&topic=${encodeURIComponent(topic)}`;

  const result = await accessFetch<Array<Record<string, unknown>>>(
    path,
    config,
    credentials,
    fetchFn,
  );

  return { logs: result, count: result.length };
};

const accessDevices: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const result = await accessFetch<Array<Record<string, unknown>>>(
    'devices',
    config,
    credentials,
    fetchFn,
  );

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
    version: '0.2.0',
    description:
      'Ubiquiti UniFi Access — doors, access logs, reader/hub devices',
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
        name: 'logs',
        description:
          'Access event log (door unlocks, denied attempts, etc.)',
        capability: 'observe',
        params: {
          topic: {
            type: 'string',
            description:
              'Filter by topic (e.g. "access.logs.add"). Omit for all.',
            required: false,
          },
          limit: {
            type: 'number',
            description: 'Page size (default: 25)',
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
    logs: systemLogs,
    devices: accessDevices,
  },

  testConnection: async (config, credentials, fetchFn) => {
    const token = credentials.credentials.apiToken ?? '';
    const endpoint = config.endpoint.replace(/\/$/, '');

    const res = await fetchFn(`${endpoint}/doors`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...config.headers,
      },
    });
    return res.ok;
  },
};
