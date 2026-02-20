import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Session cache ---

interface CachedSession {
  cookie: string;
  expiresAt: number;
}

let sessionCache: CachedSession | null = null;

/** Session TTL: 25 minutes (UniFi sessions expire after ~30 min idle) */
const SESSION_TTL_MS = 25 * 60 * 1000;

function loginPath(controllerType: string): string {
  return controllerType === 'selfhosted' ? '/api/login' : '/api/auth/login';
}

function basePath(controllerType: string, site: string): string {
  return controllerType === 'selfhosted'
    ? `/api/s/${site}/`
    : `/proxy/network/api/s/${site}/`;
}

/** Authenticate to UniFi controller and cache the session cookie */
export async function ensureSession(
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<string> {
  if (sessionCache && Date.now() < sessionCache.expiresAt) {
    return sessionCache.cookie;
  }

  const { username, password } = credentials.credentials;
  const controllerType = credentials.credentials.controllerType ?? 'udm';
  const endpoint = config.endpoint.replace(/\/$/, '');
  const url = `${endpoint}${loginPath(controllerType)}`;

  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...config.headers },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    throw new Error(`UniFi login failed: ${res.status} ${res.statusText}`);
  }

  const setCookie = res.headers.get('set-cookie') ?? '';
  if (!setCookie) {
    throw new Error('UniFi login succeeded but no session cookie returned');
  }

  // Extract the first cookie (TOKEN= or unifises=)
  const cookie = setCookie.split(';')[0] ?? setCookie;
  sessionCache = { cookie, expiresAt: Date.now() + SESSION_TTL_MS };
  return cookie;
}

/** Clear the cached session (used for testing) */
export function clearSessionCache(): void {
  sessionCache = null;
}

// --- UniFi API helper ---

/** Fetch a UniFi Network API endpoint with session auth and 401 retry */
export async function unifiFetch(
  path: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<unknown> {
  const site = credentials.credentials.site ?? 'default';
  const controllerType = credentials.credentials.controllerType ?? 'udm';
  const endpoint = config.endpoint.replace(/\/$/, '');
  const base = basePath(controllerType, site);
  const url = `${endpoint}${base}${path}`;

  const attempt = async (cookie: string): Promise<Response> => {
    return fetchFn(url, {
      headers: {
        Cookie: cookie,
        Accept: 'application/json',
        ...config.headers,
      },
    });
  };

  let cookie = await ensureSession(config, credentials, fetchFn);
  let res = await attempt(cookie);

  // Retry once on 401 (expired session)
  if (res.status === 401) {
    clearSessionCache();
    cookie = await ensureSession(config, credentials, fetchFn);
    res = await attempt(cookie);
  }

  if (!res.ok) {
    throw new Error(`UniFi API returned ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as { data?: unknown };
  return data.data ?? data;
}

// --- Probe handlers ---

const siteHealth: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const result = await unifiFetch('stat/health', config, credentials, fetchFn);
  return { health: result };
};

const devices: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const result = (await unifiFetch(
    'stat/device',
    config,
    credentials,
    fetchFn,
  )) as Array<Record<string, unknown>>;

  return {
    devices: result.map((d) => ({
      mac: d.mac,
      name: d.name,
      model: d.model,
      type: d.type,
      version: d.version,
      ip: d.ip,
      uptime: d.uptime,
      state: d.state,
      adopted: d.adopted,
      upgradable: d.upgradable,
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
  const mac = (params?.mac as string) ?? '';
  if (!mac) throw new Error('mac parameter is required (device MAC address)');

  const result = (await unifiFetch(
    `stat/device/${mac}`,
    config,
    credentials,
    fetchFn,
  )) as Array<Record<string, unknown>>;

  if (!Array.isArray(result) || result.length === 0) {
    throw new Error(`No device found with MAC ${mac}`);
  }

  return { device: result[0] };
};

const clients: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const result = (await unifiFetch(
    'stat/sta',
    config,
    credentials,
    fetchFn,
  )) as Array<Record<string, unknown>>;

  return {
    clients: result.map((c) => ({
      mac: c.mac,
      hostname: c.hostname ?? c.name,
      ip: c.ip,
      network: c.network,
      essid: c.essid,
      signal: c.signal,
      experience: c.satisfaction,
      uptime: c.uptime,
      rxBytes: c.rx_bytes,
      txBytes: c.tx_bytes,
      isWired: c.is_wired,
    })),
    count: result.length,
  };
};

const events: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const limit = (params?.limit as number) || 50;
  const result = (await unifiFetch(
    `stat/event?_limit=${limit}`,
    config,
    credentials,
    fetchFn,
  )) as Array<Record<string, unknown>>;

  return { events: result, count: result.length };
};

const alarms: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const result = (await unifiFetch(
    'stat/alarm',
    config,
    credentials,
    fetchFn,
  )) as Array<Record<string, unknown>>;

  return { alarms: result, count: result.length };
};

const portForwards: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const result = (await unifiFetch(
    'rest/portforward',
    config,
    credentials,
    fetchFn,
  )) as Array<Record<string, unknown>>;

  return {
    portForwards: result.map((pf) => ({
      name: pf.name,
      enabled: pf.enabled,
      proto: pf.proto,
      src: pf.src,
      dstPort: pf.dst_port,
      fwd: pf.fwd,
      fwdPort: pf.fwd_port,
    })),
    count: result.length,
  };
};

// --- Pack definition ---

export const unifiPack: IntegrationPack = {
  manifest: {
    name: 'unifi',
    type: 'integration',
    version: '0.1.0',
    description:
      'Ubiquiti UniFi Network — site health, devices, clients, events, alarms, port forwards',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'site.health',
        description: 'Overall site health summary (ISP, switches, APs, gateways)',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'devices',
        description:
          'List all network devices with status, model, firmware, uptime',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'device.detail',
        description: 'Single device detail by MAC address',
        capability: 'observe',
        params: {
          mac: {
            type: 'string',
            description: 'Device MAC address',
            required: true,
          },
        },
        timeout: 15000,
      },
      {
        name: 'clients',
        description:
          'Active clients with hostname, IP, MAC, signal, experience',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'events',
        description: 'Recent network events',
        capability: 'observe',
        params: {
          limit: {
            type: 'number',
            description: 'Maximum events to return (default: 50)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'alarms',
        description: 'Active alarms and alerts',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'port.forwards',
        description: 'Port forwarding rules',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
    ],
    runbook: {
      category: 'network',
      probes: ['site.health', 'devices', 'alarms'],
      parallel: true,
    },
  },

  handlers: {
    'site.health': siteHealth,
    devices,
    'device.detail': deviceDetail,
    clients,
    events,
    alarms,
    'port.forwards': portForwards,
  },

  testConnection: async (config, credentials, fetchFn) => {
    await ensureSession(config, credentials, fetchFn);
    const result = await unifiFetch('stat/health', config, credentials, fetchFn);
    return Array.isArray(result);
  },
};
