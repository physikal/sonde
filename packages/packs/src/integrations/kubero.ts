import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Auth helpers ---

/** Build Kubero auth headers: JWT Bearer token */
export function buildAuthHeaders(credentials: IntegrationCredentials): Record<string, string> {
  const token = credentials.credentials.token ?? '';
  return { Authorization: `Bearer ${token}` };
}

// --- REST helper ---

export async function kuberoGet<T>(
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
    throw new Error(`Kubero API returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// --- Probe handlers ---

const appsList: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const apps = await kuberoGet<
    Array<{
      name?: string;
      pipeline?: string;
      phase?: string;
      status?: string;
      [key: string]: unknown;
    }>
  >('/api/apps', config, credentials, fetchFn);

  const list = Array.isArray(apps) ? apps : [];
  return {
    apps: list.map((a) => ({
      name: a.name ?? null,
      pipeline: a.pipeline ?? null,
      phase: a.phase ?? null,
      status: a.status ?? null,
    })),
    count: list.length,
  };
};

const appDetail: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const pipeline = params?.pipeline as string | undefined;
  const phase = params?.phase as string | undefined;
  const app = params?.app as string | undefined;

  if (!pipeline || !phase || !app) {
    throw new Error('pipeline, phase, and app parameters are required');
  }

  const detail = await kuberoGet<Record<string, unknown>>(
    `/api/apps/${encodeURIComponent(pipeline)}/${encodeURIComponent(phase)}/${encodeURIComponent(app)}`,
    config,
    credentials,
    fetchFn,
  );

  return detail;
};

const pipelinesList: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const pipelines = await kuberoGet<
    Array<{
      name?: string;
      phases?: unknown[];
      [key: string]: unknown;
    }>
  >('/api/pipelines', config, credentials, fetchFn);

  const list = Array.isArray(pipelines) ? pipelines : [];
  return {
    pipelines: list.map((p) => ({
      name: p.name ?? null,
      phases: p.phases ?? [],
    })),
    count: list.length,
  };
};

const pipelineDetail: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const name = params?.name as string | undefined;
  if (!name) {
    throw new Error('name parameter is required');
  }

  const detail = await kuberoGet<Record<string, unknown>>(
    `/api/pipelines/${encodeURIComponent(name)}`,
    config,
    credentials,
    fetchFn,
  );

  return detail;
};

const kuberoHealth: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  await kuberoGet<Record<string, unknown>>('/api/config', config, credentials, fetchFn);
  return { reachable: true };
};

// --- Pack definition ---

export const kuberoPack: IntegrationPack = {
  manifest: {
    name: 'kubero',
    type: 'integration',
    version: '0.1.0',
    description: 'Kubero — application deployments, pipelines, and platform health',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'apps.list',
        description: 'List deployed applications with status',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'app.detail',
        description: 'Get details for a specific application',
        capability: 'observe',
        params: {
          pipeline: {
            type: 'string',
            description: 'Pipeline name',
            required: true,
          },
          phase: {
            type: 'string',
            description: 'Phase name (e.g. production, staging)',
            required: true,
          },
          app: {
            type: 'string',
            description: 'Application name',
            required: true,
          },
        },
        timeout: 15000,
      },
      {
        name: 'pipelines.list',
        description: 'List CI/CD pipelines',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'pipeline.detail',
        description: 'Get pipeline configuration and phases',
        capability: 'observe',
        params: {
          name: {
            type: 'string',
            description: 'Pipeline name',
            required: true,
          },
        },
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
      category: 'kubero',
      probes: ['health', 'apps.list'],
      parallel: true,
    },
  },

  handlers: {
    'apps.list': appsList,
    'app.detail': appDetail,
    'pipelines.list': pipelinesList,
    'pipeline.detail': pipelineDetail,
    health: kuberoHealth,
  },

  testConnection: async (config, credentials, fetchFn) => {
    const url = `${config.endpoint.replace(/\/$/, '')}/api/pipelines`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...buildAuthHeaders(credentials),
      ...config.headers,
    };

    const res = await fetchFn(url, { headers });
    return res.ok;
  },
};
