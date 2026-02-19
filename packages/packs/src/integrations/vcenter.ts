import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Session-based auth ---

/** Session token cache: token + expiry timestamp */
let cachedSession: { token: string; expiresAt: number } | null = null;

/** Acquire a vCenter session token via POST /api/session */
async function getSessionToken(
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<string> {
  const now = Date.now();
  if (cachedSession && cachedSession.expiresAt > now) {
    return cachedSession.token;
  }

  const { username, password } = credentials.credentials;
  if (!username || !password) {
    throw new Error('vCenter requires username and password credentials');
  }

  const encoded = Buffer.from(`${username}:${password}`).toString('base64');
  const url = `${config.endpoint.replace(/\/$/, '')}/api/session`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${encoded}`,
      Accept: 'application/json',
      ...config.headers,
    },
  });

  if (!res.ok) {
    throw new Error(`vCenter session auth failed: ${res.status} ${res.statusText}`);
  }

  const token = ((await res.json()) as string).replace(/^"|"$/g, '');
  cachedSession = { token, expiresAt: now + 5 * 60 * 1000 };
  return token;
}

// --- REST helper ---

async function vcenterGet<T>(
  path: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
  params?: Record<string, string>,
): Promise<T> {
  const token = await getSessionToken(config, credentials, fetchFn);
  const base = `${config.endpoint.replace(/\/$/, '')}${path}`;
  const url = new URL(base);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'vmware-api-session-id': token,
    ...config.headers,
  };

  const res = await fetchFn(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`vCenter API returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// --- Probe handlers ---

const vmList: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const vms = await vcenterGet<
    Array<{
      vm: string;
      name: string;
      power_state: string;
      cpu_count?: number;
      memory_size_MiB?: number;
    }>
  >('/api/vcenter/vm', config, credentials, fetchFn);

  return {
    vms: vms.map((vm) => ({
      vm: vm.vm,
      name: vm.name,
      powerState: vm.power_state,
      cpuCount: vm.cpu_count ?? null,
      memorySizeMiB: vm.memory_size_MiB ?? null,
    })),
    count: vms.length,
  };
};

const vmDetail: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const vm = params?.vm as string;
  if (!vm) throw new Error('vm parameter is required (VM identifier)');

  return vcenterGet(`/api/vcenter/vm/${vm}`, config, credentials, fetchFn);
};

const hostList: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const hosts = await vcenterGet<
    Array<{
      host: string;
      name: string;
      connection_state: string;
      power_state?: string;
    }>
  >('/api/vcenter/host', config, credentials, fetchFn);

  return {
    hosts: hosts.map((h) => ({
      host: h.host,
      name: h.name,
      connectionState: h.connection_state,
      powerState: h.power_state ?? null,
    })),
    count: hosts.length,
  };
};

const datastoreList: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const datastores = await vcenterGet<
    Array<{
      datastore: string;
      name: string;
      type: string;
      capacity?: number;
      free_space?: number;
    }>
  >('/api/vcenter/datastore', config, credentials, fetchFn);

  return {
    datastores: datastores.map((ds) => ({
      datastore: ds.datastore,
      name: ds.name,
      type: ds.type,
      capacity: ds.capacity ?? 0,
      freeSpace: ds.free_space ?? 0,
    })),
    count: datastores.length,
  };
};

const clusterList: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const clusters = await vcenterGet<
    Array<{
      cluster: string;
      name: string;
      ha_enabled?: boolean;
      drs_enabled?: boolean;
    }>
  >('/api/vcenter/cluster', config, credentials, fetchFn);

  return {
    clusters: clusters.map((cl) => ({
      cluster: cl.cluster,
      name: cl.name,
      haEnabled: cl.ha_enabled ?? false,
      drsEnabled: cl.drs_enabled ?? false,
    })),
    count: clusters.length,
  };
};

const health: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  return vcenterGet('/api/vcenter/system/health', config, credentials, fetchFn);
};

// --- Pack definition ---

export const vcenterPack: IntegrationPack = {
  manifest: {
    name: 'vcenter',
    type: 'integration',
    version: '0.1.0',
    description: 'VMware vCenter — VMs, ESXi hosts, datastores, clusters, and health status',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'vm.list',
        description: 'List all VMs with power state, CPU, and memory',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'vm.detail',
        description: 'Detailed info for a single VM by identifier',
        capability: 'observe',
        params: {
          vm: { type: 'string', description: 'VM identifier (e.g. vm-42)', required: true },
        },
        timeout: 15000,
      },
      {
        name: 'host.list',
        description: 'List ESXi hosts with connection state',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'datastore.list',
        description: 'List datastores with capacity and free space',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'cluster.list',
        description: 'List clusters with HA and DRS status',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'health',
        description: 'Overall vCenter health status',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
    ],
    runbook: {
      category: 'vmware',
      probes: ['health', 'host.list', 'vm.list'],
      parallel: true,
    },
  },

  handlers: {
    'vm.list': vmList,
    'vm.detail': vmDetail,
    'host.list': hostList,
    'datastore.list': datastoreList,
    'cluster.list': clusterList,
    health,
  },

  testConnection: async (config, credentials, fetchFn) => {
    try {
      await getSessionToken(config, credentials, fetchFn);
      return true;
    } catch {
      return false;
    }
  },
};
