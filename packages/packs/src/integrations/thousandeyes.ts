import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Auth helpers ---

function buildAuthHeaders(credentials: IntegrationCredentials): Record<string, string> {
  const token = credentials.credentials.token ?? '';
  return { Authorization: `Bearer ${token}` };
}

// --- REST helper ---

async function teGet<T>(
  path: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
  params?: Record<string, string>,
): Promise<T> {
  const base = `${config.endpoint.replace(/\/$/, '')}/v7${path}`;
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
    throw new Error(`ThousandEyes API returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// --- Probe handlers ---

const alertsActive: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const queryParams: Record<string, string> = {};
  const window = params?.window as string | undefined;
  if (window) queryParams.window = window;

  const data = await teGet<{
    alerts?: Array<{
      id?: string;
      type?: string;
      severity?: string;
      state?: string;
      startDate?: string;
      violationCount?: number;
      duration?: number;
    }>;
  }>('/alerts', config, credentials, fetchFn, queryParams);

  const alerts = data.alerts ?? [];
  return {
    alerts: alerts.map((a) => ({
      id: a.id ?? null,
      type: a.type ?? null,
      severity: a.severity ?? null,
      state: a.state ?? null,
      startDate: a.startDate ?? null,
      violationCount: a.violationCount ?? 0,
      duration: a.duration ?? 0,
    })),
    count: alerts.length,
  };
};

const testsList: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const queryParams: Record<string, string> = {};
  const type = params?.type as string | undefined;
  if (type) queryParams.type = type;

  const data = await teGet<{
    tests?: Array<{
      testId?: string;
      testName?: string;
      type?: string;
      enabled?: boolean;
      server?: string;
      interval?: number;
      agents?: Array<{ agentId?: string; agentName?: string }>;
    }>;
  }>('/tests', config, credentials, fetchFn, queryParams);

  const tests = data.tests ?? [];
  return {
    tests: tests.map((t) => ({
      testId: t.testId ?? null,
      testName: t.testName ?? null,
      type: t.type ?? null,
      enabled: t.enabled ?? false,
      server: t.server ?? null,
      interval: t.interval ?? 0,
      agents: t.agents ?? [],
    })),
    count: tests.length,
  };
};

const networkMetrics: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const testId = params?.testId as string;
  if (!testId) throw new Error('testId parameter is required');

  const queryParams: Record<string, string> = {};
  const window = params?.window as string | undefined;
  if (window) queryParams.window = window;

  const data = await teGet<{
    results?: Array<{
      agent?: { agentId?: string; agentName?: string; location?: string };
      avgLatency?: number;
      loss?: number;
      jitter?: number;
      serverIp?: string;
    }>;
  }>(`/test-results/${encodeURIComponent(testId)}/network`, config, credentials, fetchFn, queryParams);

  const results = data.results ?? [];
  return {
    metrics: results.map((r) => ({
      agentId: r.agent?.agentId ?? null,
      agentName: r.agent?.agentName ?? null,
      location: r.agent?.location ?? null,
      avgLatency: r.avgLatency ?? null,
      loss: r.loss ?? null,
      jitter: r.jitter ?? null,
      serverIp: r.serverIp ?? null,
    })),
    count: results.length,
  };
};

const networkPathVis: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const testId = params?.testId as string;
  if (!testId) throw new Error('testId parameter is required');

  const queryParams: Record<string, string> = {};
  const window = params?.window as string | undefined;
  if (window) queryParams.window = window;

  const data = await teGet<{
    results?: Array<{
      agent?: { agentId?: string; agentName?: string };
      pathTraces?: Array<{
        ipAddress?: string;
        responseTime?: number;
        numberOfHops?: number;
      }>;
    }>;
  }>(`/test-results/${encodeURIComponent(testId)}/path-vis`, config, credentials, fetchFn, queryParams);

  const results = data.results ?? [];
  return {
    pathVisualizations: results.map((r) => ({
      agentId: r.agent?.agentId ?? null,
      agentName: r.agent?.agentName ?? null,
      pathTraces: (r.pathTraces ?? []).map((hop) => ({
        ipAddress: hop.ipAddress ?? null,
        responseTime: hop.responseTime ?? null,
        numberOfHops: hop.numberOfHops ?? null,
      })),
    })),
    count: results.length,
  };
};

const agentsList: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = await teGet<{
    agents?: Array<{
      agentId?: string;
      agentName?: string;
      agentType?: string;
      location?: string;
      countryId?: string;
      enabled?: boolean;
    }>;
  }>('/agents', config, credentials, fetchFn);

  const agents = data.agents ?? [];
  return {
    agents: agents.map((a) => ({
      agentId: a.agentId ?? null,
      agentName: a.agentName ?? null,
      agentType: a.agentType ?? null,
      location: a.location ?? null,
      country: a.countryId ?? null,
      enabled: a.enabled ?? false,
    })),
    count: agents.length,
  };
};

const outagesNetwork: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const queryParams: Record<string, string> = {};
  const window = params?.window as string | undefined;
  if (window) queryParams.window = window;

  const data = await teGet<{
    outages?: Array<{
      type?: string;
      scope?: string;
      startDate?: string;
      endDate?: string;
      affectedTests?: number[];
    }>;
  }>('/internet-insights/outages/network', config, credentials, fetchFn, queryParams);

  const outages = data.outages ?? [];
  return {
    outages: outages.map((o) => ({
      type: o.type ?? null,
      scope: o.scope ?? null,
      startDate: o.startDate ?? null,
      endDate: o.endDate ?? null,
      affectedTests: o.affectedTests ?? [],
    })),
    count: outages.length,
  };
};

// --- Pack definition ---

export const thousandeyesPack: IntegrationPack = {
  manifest: {
    name: 'thousandeyes',
    type: 'integration',
    version: '0.1.0',
    description: 'ThousandEyes — network path analysis, latency metrics, and outage detection',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'alerts.active',
        description: 'List active alerts with severity and violation details',
        capability: 'observe',
        params: {
          window: {
            type: 'string',
            description: 'Time window for alerts (e.g. "12h")',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'tests.list',
        description: 'List configured tests with type, interval, and assigned agents',
        capability: 'observe',
        params: {
          type: {
            type: 'string',
            description: 'Filter by test type (e.g. "agent-to-server")',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'network.metrics',
        description: 'Get per-agent network metrics (latency, loss, jitter) for a test',
        capability: 'observe',
        params: {
          testId: {
            type: 'string',
            description: 'ThousandEyes test ID',
            required: true,
          },
          window: {
            type: 'string',
            description: 'Time window for results (e.g. "1h")',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'network.path-vis',
        description: 'Get hop-by-hop path visualization for a test',
        capability: 'observe',
        params: {
          testId: {
            type: 'string',
            description: 'ThousandEyes test ID',
            required: true,
          },
          window: {
            type: 'string',
            description: 'Time window for results (e.g. "1h")',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'agents.list',
        description: 'List ThousandEyes agents with type, location, and status',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'outages.network',
        description: 'List detected internet outages affecting tests',
        capability: 'observe',
        params: {
          window: {
            type: 'string',
            description: 'Time window for outages (e.g. "24h")',
            required: false,
          },
        },
        timeout: 15000,
      },
    ],
    runbook: {
      category: 'network',
      probes: ['alerts.active', 'agents.list'],
      parallel: true,
    },
  },

  handlers: {
    'alerts.active': alertsActive,
    'tests.list': testsList,
    'network.metrics': networkMetrics,
    'network.path-vis': networkPathVis,
    'agents.list': agentsList,
    'outages.network': outagesNetwork,
  },

  testConnection: async (config, credentials, fetchFn) => {
    const url = `${config.endpoint.replace(/\/$/, '')}/v7/agents`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...buildAuthHeaders(credentials),
      ...config.headers,
    };

    const res = await fetchFn(url, { headers });
    return res.ok;
  },
};
