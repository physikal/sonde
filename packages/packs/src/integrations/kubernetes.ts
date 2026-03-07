import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Auth helpers ---

export function buildAuthHeaders(credentials: IntegrationCredentials): Record<string, string> {
  const token = credentials.credentials.token ?? '';
  return { Authorization: `Bearer ${token}` };
}

// --- REST helper ---

export async function k8sGet<T>(
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
    throw new Error(`Kubernetes API returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// --- K8s response types ---

interface K8sPod {
  metadata?: { name?: string; namespace?: string };
  status?: {
    phase?: string;
    containerStatuses?: Array<{
      name?: string;
      ready?: boolean;
      restartCount?: number;
    }>;
  };
  spec?: { nodeName?: string };
}

interface K8sNode {
  metadata?: { name?: string };
  status?: {
    conditions?: Array<{
      type?: string;
      status?: string;
    }>;
    nodeInfo?: {
      kubeletVersion?: string;
      osImage?: string;
    };
  };
}

interface K8sEvent {
  type?: string;
  reason?: string;
  message?: string;
  involvedObject?: {
    kind?: string;
    name?: string;
    namespace?: string;
  };
  firstTimestamp?: string;
  lastTimestamp?: string;
  count?: number;
}

interface K8sDeployment {
  metadata?: { name?: string; namespace?: string };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    updatedReplicas?: number;
  };
}

// --- Probe handlers ---

const podsList: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const namespace = params?.namespace as string | undefined;
  const labelSelector = params?.labelSelector as string | undefined;

  const path = namespace
    ? `/api/v1/namespaces/${namespace}/pods`
    : '/api/v1/pods';

  const queryParams: Record<string, string> = {};
  if (labelSelector) queryParams.labelSelector = labelSelector;

  const data = await k8sGet<{ items?: K8sPod[] }>(
    path, config, credentials, fetchFn, queryParams,
  );

  const items = data.items ?? [];
  return {
    pods: items.map((p) => ({
      name: p.metadata?.name ?? '',
      namespace: p.metadata?.namespace ?? '',
      status: p.status?.phase ?? 'Unknown',
      nodeName: p.spec?.nodeName ?? null,
      containers: (p.status?.containerStatuses ?? []).map((c) => ({
        name: c.name ?? '',
        ready: c.ready ?? false,
      })),
      restarts: (p.status?.containerStatuses ?? []).reduce(
        (sum, c) => sum + (c.restartCount ?? 0), 0,
      ),
    })),
    count: items.length,
  };
};

const podsFailing: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = await k8sGet<{ items?: K8sPod[] }>(
    '/api/v1/pods', config, credentials, fetchFn,
  );

  const items = data.items ?? [];
  const failing = items.filter((p) => {
    const phase = p.status?.phase ?? 'Unknown';
    return phase !== 'Running' && phase !== 'Succeeded';
  });

  return {
    pods: failing.map((p) => ({
      name: p.metadata?.name ?? '',
      namespace: p.metadata?.namespace ?? '',
      status: p.status?.phase ?? 'Unknown',
      nodeName: p.spec?.nodeName ?? null,
      containers: (p.status?.containerStatuses ?? []).map((c) => ({
        name: c.name ?? '',
        ready: c.ready ?? false,
      })),
      restarts: (p.status?.containerStatuses ?? []).reduce(
        (sum, c) => sum + (c.restartCount ?? 0), 0,
      ),
    })),
    count: failing.length,
  };
};

const nodesList: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = await k8sGet<{ items?: K8sNode[] }>(
    '/api/v1/nodes', config, credentials, fetchFn,
  );

  const items = data.items ?? [];
  return {
    nodes: items.map((n) => {
      const conditions = n.status?.conditions ?? [];
      const readyCondition = conditions.find((c) => c.type === 'Ready');
      const status = readyCondition?.status === 'True' ? 'Ready' : 'NotReady';

      return {
        name: n.metadata?.name ?? '',
        status,
        conditions: conditions.map((c) => ({
          type: c.type ?? '',
          status: c.status ?? '',
        })),
        kubeletVersion: n.status?.nodeInfo?.kubeletVersion ?? null,
        osImage: n.status?.nodeInfo?.osImage ?? null,
      };
    }),
    count: items.length,
  };
};

const eventsRecent: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = await k8sGet<{ items?: K8sEvent[] }>(
    '/api/v1/events', config, credentials, fetchFn,
    { 'fieldSelector': 'type!=Normal' },
  );

  const items = data.items ?? [];
  return {
    events: items.map((e) => ({
      type: e.type ?? null,
      reason: e.reason ?? null,
      message: e.message ?? null,
      involvedObject: e.involvedObject
        ? {
            kind: e.involvedObject.kind ?? null,
            name: e.involvedObject.name ?? null,
            namespace: e.involvedObject.namespace ?? null,
          }
        : null,
      firstTimestamp: e.firstTimestamp ?? null,
      lastTimestamp: e.lastTimestamp ?? null,
      count: e.count ?? 0,
    })),
    count: items.length,
  };
};

const podsLogs: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const namespace = params?.namespace as string | undefined;
  const pod = params?.pod as string | undefined;
  if (!namespace) throw new Error('namespace parameter is required');
  if (!pod) throw new Error('pod parameter is required');

  const lines = (params?.lines as number) || 100;
  const path = `/api/v1/namespaces/${namespace}/pods/${pod}/log`;

  const base = `${config.endpoint.replace(/\/$/, '')}${path}`;
  const url = new URL(base);
  url.searchParams.set('tailLines', String(lines));

  const headers: Record<string, string> = {
    ...buildAuthHeaders(credentials),
    ...config.headers,
  };

  const res = await fetchFn(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`Kubernetes API returned ${res.status}: ${res.statusText}`);
  }

  const logs = await res.text();
  return { logs, pod, namespace, lines };
};

const deploymentsList: IntegrationProbeHandler = async (
  params, config, credentials, fetchFn,
) => {
  const namespace = params?.namespace as string | undefined;
  const path = namespace
    ? `/apis/apps/v1/namespaces/${namespace}/deployments`
    : '/apis/apps/v1/deployments';

  const data = await k8sGet<{ items?: K8sDeployment[] }>(
    path, config, credentials, fetchFn,
  );

  const items = data.items ?? [];
  return {
    deployments: items.map((d) => ({
      name: d.metadata?.name ?? '',
      namespace: d.metadata?.namespace ?? '',
      replicas: d.status?.replicas ?? 0,
      readyReplicas: d.status?.readyReplicas ?? 0,
      availableReplicas: d.status?.availableReplicas ?? 0,
      updatedReplicas: d.status?.updatedReplicas ?? 0,
    })),
    count: items.length,
  };
};

const k8sHealth: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  await k8sGet<unknown>(
    '/api/v1/namespaces/default/pods', config, credentials, fetchFn,
    { limit: '1' },
  );
  return { reachable: true };
};

// --- Pack definition ---

export const kubernetesPack: IntegrationPack = {
  manifest: {
    name: 'kubernetes',
    type: 'integration',
    version: '0.1.0',
    description: 'Kubernetes — pods, nodes, deployments, events, and logs',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'pods.list',
        description: 'List pods with status, optionally filtered by namespace',
        capability: 'observe',
        params: {
          namespace: {
            type: 'string',
            description: 'Kubernetes namespace (all namespaces if omitted)',
            required: false,
          },
          labelSelector: {
            type: 'string',
            description: 'Label selector to filter pods (e.g. app=nginx)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'pods.failing',
        description: 'Pods not in Running or Succeeded state',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'nodes.list',
        description: 'List nodes with conditions and versions',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'events.recent',
        description: 'Warning and error events from the cluster',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'pods.logs',
        description: 'Tail pod logs',
        capability: 'observe',
        params: {
          namespace: {
            type: 'string',
            description: 'Pod namespace',
            required: true,
          },
          pod: {
            type: 'string',
            description: 'Pod name',
            required: true,
          },
          lines: {
            type: 'number',
            description: 'Number of log lines to tail (default: 100)',
            required: false,
          },
        },
        timeout: 30000,
      },
      {
        name: 'deployments.list',
        description: 'Deployments with replica status',
        capability: 'observe',
        params: {
          namespace: {
            type: 'string',
            description: 'Kubernetes namespace (all namespaces if omitted)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'health',
        description: 'Validate Kubernetes API connectivity',
        capability: 'observe',
        params: {},
        timeout: 10000,
      },
    ],
    runbook: {
      category: 'kubernetes',
      probes: ['health', 'pods.failing', 'events.recent'],
      parallel: true,
    },
  },

  handlers: {
    'pods.list': podsList,
    'pods.failing': podsFailing,
    'nodes.list': nodesList,
    'events.recent': eventsRecent,
    'pods.logs': podsLogs,
    'deployments.list': deploymentsList,
    health: k8sHealth,
  },

  testConnection: async (config, credentials, fetchFn) => {
    const url = `${config.endpoint.replace(/\/$/, '')}/api/v1/namespaces/default/pods?limit=1`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...buildAuthHeaders(credentials),
      ...config.headers,
    };

    const res = await fetchFn(url, { headers });
    return res.ok;
  },
};
