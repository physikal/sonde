import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Auth helpers ---

function buildAuthHeaders(credentials: IntegrationCredentials): Record<string, string> {
  const apiKey = credentials.credentials.apiKey ?? '';
  return { Authorization: `Bearer ${apiKey}` };
}

// --- REST helper ---

async function merakiGet<T>(
  path: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
  params?: Record<string, string>,
): Promise<T> {
  const base = `${config.endpoint.replace(/\/$/, '')}/api/v1${path}`;
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
    throw new Error(`Meraki API returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// --- Probe handlers ---

const organizationsList: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const orgs = await merakiGet<
    Array<{
      id?: string;
      name?: string;
      url?: string;
    }>
  >('/organizations', config, credentials, fetchFn);

  return {
    organizations: orgs.map((o) => ({
      id: o.id ?? null,
      name: o.name ?? null,
      url: o.url ?? null,
    })),
    count: orgs.length,
  };
};

const devicesStatuses: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const orgId = (params?.orgId as string) || credentials.credentials.orgId;
  if (!orgId) throw new Error('orgId parameter is required');

  const devices = await merakiGet<
    Array<{
      name?: string;
      serial?: string;
      model?: string;
      status?: string;
      lanIp?: string;
      mac?: string;
      networkId?: string;
    }>
  >(`/organizations/${encodeURIComponent(orgId)}/devices/statuses`, config, credentials, fetchFn);

  return {
    devices: devices.map((d) => ({
      name: d.name ?? null,
      serial: d.serial ?? null,
      model: d.model ?? null,
      status: d.status ?? null,
      lanIp: d.lanIp ?? null,
      mac: d.mac ?? null,
      networkId: d.networkId ?? null,
    })),
    count: devices.length,
  };
};

const switchPortStatuses: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const serial = params?.serial as string;
  if (!serial) throw new Error('serial parameter is required');

  const ports = await merakiGet<
    Array<{
      portId?: string;
      enabled?: boolean;
      status?: string;
      speed?: string;
      duplex?: string;
      cdp?: Record<string, unknown>;
      lldp?: Record<string, unknown>;
      errors?: string[];
      usageInKb?: { sent?: number; recv?: number };
    }>
  >(`/devices/${encodeURIComponent(serial)}/switch/ports/statuses`, config, credentials, fetchFn);

  return {
    ports: ports.map((p) => ({
      portId: p.portId ?? null,
      enabled: p.enabled ?? false,
      status: p.status ?? null,
      speed: p.speed ?? null,
      duplex: p.duplex ?? null,
      cdp: p.cdp ?? null,
      lldp: p.lldp ?? null,
      errors: p.errors ?? [],
      usage: p.usageInKb ?? null,
    })),
    count: ports.length,
  };
};

const deviceLldpCdp: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const serial = params?.serial as string;
  if (!serial) throw new Error('serial parameter is required');

  const data = await merakiGet<{
    ports?: Record<
      string,
      {
        cdp?: { deviceId?: string; platform?: string; portId?: string; address?: string };
        lldp?: { systemName?: string; portId?: string; managementAddress?: string };
      }
    >;
  }>(`/devices/${encodeURIComponent(serial)}/lldpCdp`, config, credentials, fetchFn);

  const ports = data.ports ?? {};
  const neighbors = Object.entries(ports).map(([portId, info]) => ({
    portId,
    cdp: info.cdp ?? null,
    lldp: info.lldp ?? null,
  }));

  return { neighbors, count: neighbors.length };
};

const deviceClients: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const serial = params?.serial as string;
  if (!serial) throw new Error('serial parameter is required');

  const queryParams: Record<string, string> = {};
  const timespan = params?.timespan as number | undefined;
  if (timespan) queryParams.timespan = String(timespan);

  const clients = await merakiGet<
    Array<{
      mac?: string;
      ip?: string;
      description?: string;
      vlan?: number;
      switchport?: string;
      usage?: { sent?: number; recv?: number };
    }>
  >(
    `/devices/${encodeURIComponent(serial)}/clients`,
    config,
    credentials,
    fetchFn,
    queryParams,
  );

  return {
    clients: clients.map((c) => ({
      mac: c.mac ?? null,
      ip: c.ip ?? null,
      description: c.description ?? null,
      vlan: c.vlan ?? null,
      switchport: c.switchport ?? null,
      usage: c.usage ?? null,
    })),
    count: clients.length,
  };
};

const networksList: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const orgId = (params?.orgId as string) || credentials.credentials.orgId;
  if (!orgId) throw new Error('orgId parameter is required');

  const networks = await merakiGet<
    Array<{
      id?: string;
      name?: string;
      productTypes?: string[];
      timeZone?: string;
      tags?: string[];
    }>
  >(`/organizations/${encodeURIComponent(orgId)}/networks`, config, credentials, fetchFn);

  return {
    networks: networks.map((n) => ({
      id: n.id ?? null,
      name: n.name ?? null,
      productTypes: n.productTypes ?? [],
      timeZone: n.timeZone ?? null,
      tags: n.tags ?? [],
    })),
    count: networks.length,
  };
};

// --- Pack definition ---

export const merakiPack: IntegrationPack = {
  manifest: {
    name: 'meraki',
    type: 'integration',
    version: '0.1.0',
    description: 'Cisco Meraki — device fleet status, switch ports, and network topology',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'organizations.list',
        description: 'List organizations accessible by the API key',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'devices.statuses',
        description: 'List device statuses across an organization',
        capability: 'observe',
        params: {
          orgId: {
            type: 'string',
            description: 'Meraki organization ID (falls back to credential orgId)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'switch.port-statuses',
        description: 'Get port statuses for a switch including speed, duplex, and neighbors',
        capability: 'observe',
        params: {
          serial: {
            type: 'string',
            description: 'Device serial number',
            required: true,
          },
        },
        timeout: 15000,
      },
      {
        name: 'device.lldp-cdp',
        description: 'Get LLDP and CDP neighbor information for a device',
        capability: 'observe',
        params: {
          serial: {
            type: 'string',
            description: 'Device serial number',
            required: true,
          },
        },
        timeout: 15000,
      },
      {
        name: 'device.clients',
        description: 'List clients connected to a device',
        capability: 'observe',
        params: {
          serial: {
            type: 'string',
            description: 'Device serial number',
            required: true,
          },
          timespan: {
            type: 'number',
            description: 'Lookback period in seconds (default: 86400)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'networks.list',
        description: 'List networks in an organization',
        capability: 'observe',
        params: {
          orgId: {
            type: 'string',
            description: 'Meraki organization ID (falls back to credential orgId)',
            required: false,
          },
        },
        timeout: 15000,
      },
    ],
    runbook: {
      category: 'network',
      probes: ['organizations.list', 'devices.statuses'],
      parallel: true,
    },
  },

  handlers: {
    'organizations.list': organizationsList,
    'devices.statuses': devicesStatuses,
    'switch.port-statuses': switchPortStatuses,
    'device.lldp-cdp': deviceLldpCdp,
    'device.clients': deviceClients,
    'networks.list': networksList,
  },

  testConnection: async (config, credentials, fetchFn) => {
    const url = `${config.endpoint.replace(/\/$/, '')}/api/v1/organizations`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...buildAuthHeaders(credentials),
      ...config.headers,
    };

    const res = await fetchFn(url, { headers });
    return res.ok;
  },
};
