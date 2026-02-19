import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Session-based auth ---

/** Auth signature cache: signature + expiry timestamp */
let cachedSession: { signature: string; expiresAt: number } | null = null;

/** Acquire an A10 auth signature via POST /axapi/v3/auth */
async function getSignature(
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<string> {
  const now = Date.now();
  if (cachedSession && cachedSession.expiresAt > now) {
    return cachedSession.signature;
  }

  const { username, password } = credentials.credentials;
  if (!username || !password) {
    throw new Error('A10 Networks requires username and password credentials');
  }

  const url = `${config.endpoint.replace(/\/$/, '')}/axapi/v3/auth`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...config.headers,
    },
    body: JSON.stringify({ credentials: { username, password } }),
  });

  if (!res.ok) {
    throw new Error(`A10 auth failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    authresponse?: { signature?: string };
  };
  const signature = data.authresponse?.signature;
  if (!signature) {
    throw new Error('A10 auth response missing signature');
  }

  cachedSession = { signature, expiresAt: now + 5 * 60 * 1000 };
  return signature;
}

// --- REST helper ---

async function a10Get<T>(
  apiPath: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
  params?: Record<string, string>,
): Promise<T> {
  const signature = await getSignature(config, credentials, fetchFn);
  const base = `${config.endpoint.replace(/\/$/, '')}/axapi/v3/${apiPath}`;
  const url = new URL(base);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `A10 ${signature}`,
    ...config.headers,
  };

  const res = await fetchFn(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`A10 API returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// --- Probe handlers ---

const systemInfo: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const data = await a10Get<{
    version?: {
      oper?: {
        'sw-version'?: string;
        'serial-number'?: string;
        'platform-name'?: string;
        'up-time'?: string;
      };
    };
  }>('version/oper', config, credentials, fetchFn);

  const oper = data.version?.oper ?? {};
  return {
    version: oper['sw-version'] ?? null,
    serialNumber: oper['serial-number'] ?? null,
    platform: oper['platform-name'] ?? null,
    uptime: oper['up-time'] ?? null,
  };
};

const virtualServersList: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const data = await a10Get<{
    'virtual-server-list'?: Array<{
      name?: string;
      'ip-address'?: string;
      status?: string;
      'port-list'?: Array<{
        'port-number'?: number;
        protocol?: string;
        status?: string;
      }>;
    }>;
  }>('slb/virtual-server', config, credentials, fetchFn);

  const servers = (data['virtual-server-list'] ?? []).map((vs) => ({
    name: vs.name ?? null,
    ipAddress: vs['ip-address'] ?? null,
    status: vs.status ?? null,
    ports: (vs['port-list'] ?? []).map((p) => ({
      portNumber: p['port-number'] ?? null,
      protocol: p.protocol ?? null,
      status: p.status ?? null,
    })),
  }));

  return { virtualServers: servers, count: servers.length };
};

const virtualServerStats: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const name = params?.name as string;
  if (!name) throw new Error('name parameter is required (virtual server name)');

  const data = await a10Get<{
    'virtual-server'?: {
      stats?: {
        'curr-conn'?: number;
        'total-conn'?: number;
        'bytes-in'?: number;
        'bytes-out'?: number;
      };
    };
  }>(
    `slb/virtual-server/${encodeURIComponent(name)}/stats`,
    config,
    credentials,
    fetchFn,
  );

  const stats = data['virtual-server']?.stats ?? {};
  return {
    name,
    currConn: stats['curr-conn'] ?? 0,
    totalConn: stats['total-conn'] ?? 0,
    bytesIn: stats['bytes-in'] ?? 0,
    bytesOut: stats['bytes-out'] ?? 0,
  };
};

const serviceGroupsList: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const data = await a10Get<{
    'service-group-list'?: Array<{
      name?: string;
      protocol?: string;
      'lb-method'?: string;
      'member-list'?: Array<{
        name?: string;
        port?: number;
        'member-state'?: string;
      }>;
    }>;
  }>('slb/service-group', config, credentials, fetchFn);

  const groups = (data['service-group-list'] ?? []).map((sg) => ({
    name: sg.name ?? null,
    protocol: sg.protocol ?? null,
    lbMethod: sg['lb-method'] ?? null,
    members: (sg['member-list'] ?? []).map((m) => ({
      name: m.name ?? null,
      port: m.port ?? null,
      state: m['member-state'] ?? null,
    })),
  }));

  return { serviceGroups: groups, count: groups.length };
};

const serversList: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const data = await a10Get<{
    'server-list'?: Array<{
      name?: string;
      host?: string;
      status?: string;
      'port-list'?: Array<{
        'port-number'?: number;
        protocol?: string;
        'health-check'?: string;
        status?: string;
      }>;
    }>;
  }>('slb/server', config, credentials, fetchFn);

  const servers = (data['server-list'] ?? []).map((s) => ({
    name: s.name ?? null,
    host: s.host ?? null,
    status: s.status ?? null,
    ports: (s['port-list'] ?? []).map((p) => ({
      portNumber: p['port-number'] ?? null,
      protocol: p.protocol ?? null,
      healthCheck: p['health-check'] ?? null,
      status: p.status ?? null,
    })),
  }));

  return { servers, count: servers.length };
};

const interfacesStats: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const data = await a10Get<{
    ethernet?: {
      oper?: {
        'interface-list'?: Array<{
          'port-num'?: number;
          status?: string;
          speed?: string;
          'rx-pkts'?: number;
          'tx-pkts'?: number;
          'rx-errors'?: number;
          'tx-errors'?: number;
        }>;
      };
    };
  }>('interface/ethernet/oper', config, credentials, fetchFn);

  const interfaces = (data.ethernet?.oper?.['interface-list'] ?? []).map((iface) => ({
    portNum: iface['port-num'] ?? null,
    status: iface.status ?? null,
    speed: iface.speed ?? null,
    rxPackets: iface['rx-pkts'] ?? 0,
    txPackets: iface['tx-pkts'] ?? 0,
    rxErrors: iface['rx-errors'] ?? 0,
    txErrors: iface['tx-errors'] ?? 0,
  }));

  return { interfaces, count: interfaces.length };
};

// --- Pack definition ---

export const a10Pack: IntegrationPack = {
  manifest: {
    name: 'a10',
    type: 'integration',
    version: '0.1.0',
    description:
      'A10 Networks — virtual servers, service groups, real server health, and interface stats',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'system.info',
        description: 'System version, serial number, platform, and uptime',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'virtual-servers.list',
        description: 'List virtual servers (VIPs) with port and status info',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'virtual-server.stats',
        description: 'Connection and throughput stats for a virtual server',
        capability: 'observe',
        params: {
          name: {
            type: 'string',
            description: 'Virtual server name',
            required: true,
          },
        },
        timeout: 15000,
      },
      {
        name: 'service-groups.list',
        description: 'List service groups with members and health status',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'servers.list',
        description: 'List real servers with port health checks',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'interfaces.stats',
        description: 'Ethernet interface stats: packets, errors, speed, and status',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
    ],
    runbook: {
      category: 'load-balancer',
      probes: ['system.info', 'virtual-servers.list'],
      parallel: true,
    },
  },

  handlers: {
    'system.info': systemInfo,
    'virtual-servers.list': virtualServersList,
    'virtual-server.stats': virtualServerStats,
    'service-groups.list': serviceGroupsList,
    'servers.list': serversList,
    'interfaces.stats': interfacesStats,
  },

  testConnection: async (config, credentials, fetchFn) => {
    try {
      await getSignature(config, credentials, fetchFn);
      return true;
    } catch {
      return false;
    }
  },
};
