import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Session-based auth ---

/** Session ID cache: sid + expiry timestamp */
let cachedSession: { sid: string; expiresAt: number } | null = null;

/** Acquire a Check Point session ID via POST /web_api/login */
async function getSessionId(
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<string> {
  const now = Date.now();
  if (cachedSession && cachedSession.expiresAt > now) {
    return cachedSession.sid;
  }

  const { username, password } = credentials.credentials;
  if (!username || !password) {
    throw new Error('Check Point requires username and password credentials');
  }

  const url = `${config.endpoint.replace(/\/$/, '')}/web_api/login`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...config.headers,
    },
    body: JSON.stringify({ user: username, password }),
  });

  if (!res.ok) {
    throw new Error(`Check Point login failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { sid?: string };
  if (!data.sid) {
    throw new Error('Check Point login response missing sid');
  }

  cachedSession = { sid: data.sid, expiresAt: now + 5 * 60 * 1000 };
  return data.sid;
}

// --- REST helper ---

async function cpPost<T>(
  command: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
  body?: Record<string, unknown>,
): Promise<T> {
  const sid = await getSessionId(config, credentials, fetchFn);
  const url = `${config.endpoint.replace(/\/$/, '')}/web_api/${command}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-chkp-sid': sid,
    ...config.headers,
  };

  const res = await fetchFn(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });

  if (!res.ok) {
    throw new Error(`Check Point API returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// --- Probe handlers ---

const gatewaysList: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const detailsLevel = (params?.detailsLevel as string) || 'standard';
  const data = await cpPost<{
    objects?: Array<{
      uid?: string;
      name?: string;
      type?: string;
      'ipv4-address'?: string;
      policy?: { name?: string };
      version?: string;
    }>;
    total?: number;
  }>('show-gateways-and-servers', config, credentials, fetchFn, {
    'details-level': detailsLevel,
  });

  const gateways = (data.objects ?? []).map((gw) => ({
    uid: gw.uid ?? null,
    name: gw.name ?? null,
    type: gw.type ?? null,
    ipv4Address: gw['ipv4-address'] ?? null,
    policy: gw.policy?.name ?? null,
    version: gw.version ?? null,
  }));

  return { gateways, count: gateways.length, total: data.total ?? gateways.length };
};

const accessLayersList: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const body: Record<string, unknown> = {};
  const limit = params?.limit as number | undefined;
  if (limit) body.limit = limit;

  const data = await cpPost<{
    'access-layers'?: Array<{
      uid?: string;
      name?: string;
      domain?: { name?: string };
    }>;
    total?: number;
  }>('show-access-layers', config, credentials, fetchFn, body);

  const layers = (data['access-layers'] ?? []).map((l) => ({
    uid: l.uid ?? null,
    name: l.name ?? null,
    domain: l.domain?.name ?? null,
  }));

  return { layers, count: layers.length, total: data.total ?? layers.length };
};

const accessRulesShow: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const name = params?.name as string;
  if (!name) throw new Error('name parameter is required (access layer name)');

  const body: Record<string, unknown> = { name };
  const limit = params?.limit as number | undefined;
  if (limit) body.limit = limit;

  const data = await cpPost<{
    rulebase?: Array<{
      'rule-number'?: number;
      action?: { name?: string };
      source?: Array<{ name?: string }>;
      destination?: Array<{ name?: string }>;
      service?: Array<{ name?: string }>;
      enabled?: boolean;
    }>;
    total?: number;
  }>('show-access-rulebase', config, credentials, fetchFn, body);

  const rules = (data.rulebase ?? []).map((r) => ({
    ruleNumber: r['rule-number'] ?? null,
    action: r.action?.name ?? null,
    source: (r.source ?? []).map((s) => s.name ?? 'unknown'),
    destination: (r.destination ?? []).map((d) => d.name ?? 'unknown'),
    service: (r.service ?? []).map((s) => s.name ?? 'unknown'),
    enabled: r.enabled ?? true,
  }));

  return { rules, count: rules.length, total: data.total ?? rules.length };
};

const hostsList: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const body: Record<string, unknown> = {};
  const limit = params?.limit as number | undefined;
  if (limit) body.limit = limit;

  const data = await cpPost<{
    objects?: Array<{
      uid?: string;
      name?: string;
      'ipv4-address'?: string;
    }>;
    total?: number;
  }>('show-hosts', config, credentials, fetchFn, body);

  const hosts = (data.objects ?? []).map((h) => ({
    uid: h.uid ?? null,
    name: h.name ?? null,
    ipv4Address: h['ipv4-address'] ?? null,
  }));

  return { hosts, count: hosts.length, total: data.total ?? hosts.length };
};

const networksList: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const body: Record<string, unknown> = {};
  const limit = params?.limit as number | undefined;
  if (limit) body.limit = limit;

  const data = await cpPost<{
    objects?: Array<{
      uid?: string;
      name?: string;
      subnet4?: string;
      'mask-length4'?: number;
    }>;
    total?: number;
  }>('show-networks', config, credentials, fetchFn, body);

  const networks = (data.objects ?? []).map((n) => ({
    uid: n.uid ?? null,
    name: n.name ?? null,
    subnet4: n.subnet4 ?? null,
    maskLength4: n['mask-length4'] ?? null,
  }));

  return { networks, count: networks.length, total: data.total ?? networks.length };
};

const tasksList: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const data = await cpPost<{
    tasks?: Array<{
      'task-id'?: string;
      'task-name'?: string;
      status?: string;
      progress?: number;
      'start-date'?: string;
    }>;
  }>('show-tasks', config, credentials, fetchFn);

  const tasks = (data.tasks ?? []).map((t) => ({
    taskId: t['task-id'] ?? null,
    taskName: t['task-name'] ?? null,
    status: t.status ?? null,
    progress: t.progress ?? null,
    startDate: t['start-date'] ?? null,
  }));

  return { tasks, count: tasks.length };
};

// --- Pack definition ---

export const checkpointPack: IntegrationPack = {
  manifest: {
    name: 'checkpoint',
    type: 'integration',
    version: '0.1.0',
    description:
      'Check Point — firewall gateways, access policies, network objects, and management tasks',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'gateways.list',
        description: 'List gateways and servers with policy and version info',
        capability: 'observe',
        params: {
          detailsLevel: {
            type: 'string',
            description: 'Detail level: uid, standard, or full (default: standard)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'access-layers.list',
        description: 'List access control policy layers',
        capability: 'observe',
        params: {
          limit: {
            type: 'number',
            description: 'Max results to return',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'access-rules.show',
        description: 'Show access rulebase for a named layer',
        capability: 'observe',
        params: {
          name: {
            type: 'string',
            description: 'Access layer name',
            required: true,
          },
          limit: {
            type: 'number',
            description: 'Max rules to return',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'hosts.list',
        description: 'List host objects with IP addresses',
        capability: 'observe',
        params: {
          limit: {
            type: 'number',
            description: 'Max results to return',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'networks.list',
        description: 'List network objects with subnet and mask',
        capability: 'observe',
        params: {
          limit: {
            type: 'number',
            description: 'Max results to return',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'tasks.list',
        description: 'List recent management tasks with status and progress',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
    ],
    runbook: {
      category: 'security',
      probes: ['gateways.list', 'tasks.list'],
      parallel: true,
    },
  },

  handlers: {
    'gateways.list': gatewaysList,
    'access-layers.list': accessLayersList,
    'access-rules.show': accessRulesShow,
    'hosts.list': hostsList,
    'networks.list': networksList,
    'tasks.list': tasksList,
  },

  testConnection: async (config, credentials, fetchFn) => {
    try {
      await getSessionId(config, credentials, fetchFn);
      return true;
    } catch {
      return false;
    }
  },
};
