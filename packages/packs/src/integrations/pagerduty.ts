import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Auth helpers ---

/** Build PagerDuty auth header: Token token=<key> */
function buildAuthHeaders(credentials: IntegrationCredentials): Record<string, string> {
  const token = credentials.credentials.token ?? '';
  return { Authorization: `Token token=${token}` };
}

// --- REST helper ---

async function pagerdutyGet<T>(
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
    'Content-Type': 'application/json',
    ...buildAuthHeaders(credentials),
    ...config.headers,
  };

  const res = await fetchFn(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`PagerDuty API returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// --- Probe handlers ---

const incidentsList: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const queryParams: Record<string, string> = {};
  const status = params?.status as string | undefined;
  if (status) queryParams['statuses[]'] = status;
  const since = params?.since as string | undefined;
  if (since) queryParams.since = since;
  const until = params?.until as string | undefined;
  if (until) queryParams.until = until;

  const data = await pagerdutyGet<{
    incidents?: Array<{
      id: string;
      incident_number?: number;
      title?: string;
      status?: string;
      urgency?: string;
      created_at?: string;
      service?: { id?: string; summary?: string };
      assignees?: Array<{ summary?: string }>;
    }>;
    total?: number;
  }>('/incidents', config, credentials, fetchFn, queryParams);

  const incidents = data.incidents ?? [];
  return {
    incidents: incidents.map((i) => ({
      id: i.id,
      incidentNumber: i.incident_number ?? null,
      title: i.title ?? null,
      status: i.status ?? null,
      urgency: i.urgency ?? null,
      createdAt: i.created_at ?? null,
      service: i.service?.summary ?? null,
      assignees: (i.assignees ?? []).map((a) => a.summary ?? ''),
    })),
    total: data.total ?? incidents.length,
    count: incidents.length,
  };
};

const incidentsTriggered: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const data = await pagerdutyGet<{
    incidents?: Array<{
      id: string;
      incident_number?: number;
      title?: string;
      status?: string;
      urgency?: string;
      created_at?: string;
      service?: { id?: string; summary?: string };
      assignees?: Array<{ summary?: string }>;
    }>;
    total?: number;
  }>('/incidents', config, credentials, fetchFn, {
    'statuses[]': 'triggered,acknowledged',
  });

  const incidents = data.incidents ?? [];
  return {
    incidents: incidents.map((i) => ({
      id: i.id,
      incidentNumber: i.incident_number ?? null,
      title: i.title ?? null,
      status: i.status ?? null,
      urgency: i.urgency ?? null,
      createdAt: i.created_at ?? null,
      service: i.service?.summary ?? null,
      assignees: (i.assignees ?? []).map((a) => a.summary ?? ''),
    })),
    total: data.total ?? incidents.length,
    count: incidents.length,
  };
};

const servicesList: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = await pagerdutyGet<{
    services?: Array<{
      id: string;
      name?: string;
      status?: string;
      description?: string;
      created_at?: string;
    }>;
    total?: number;
  }>('/services', config, credentials, fetchFn);

  const services = data.services ?? [];
  return {
    services: services.map((s) => ({
      id: s.id,
      name: s.name ?? null,
      status: s.status ?? null,
      description: s.description ?? null,
      createdAt: s.created_at ?? null,
    })),
    count: services.length,
  };
};

const serviceDetail: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const id = params?.id as string;
  if (!id) throw new Error('id parameter is required (service ID)');

  const data = await pagerdutyGet<{
    service?: {
      id: string;
      name?: string;
      status?: string;
      description?: string;
      escalation_policy?: { id?: string; summary?: string };
      integrations?: Array<{ id?: string; summary?: string; type?: string }>;
    };
  }>(`/services/${id}`, config, credentials, fetchFn);

  const svc = data.service;
  if (!svc) throw new Error(`Service ${id} not found`);

  return {
    id: svc.id,
    name: svc.name ?? null,
    status: svc.status ?? null,
    description: svc.description ?? null,
    escalationPolicy: svc.escalation_policy?.summary ?? null,
    integrations: (svc.integrations ?? []).map((i) => ({
      id: i.id ?? null,
      summary: i.summary ?? null,
      type: i.type ?? null,
    })),
  };
};

const oncallList: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const queryParams: Record<string, string> = {};
  const scheduleIds = params?.schedule_ids as string | undefined;
  if (scheduleIds) queryParams['schedule_ids[]'] = scheduleIds;

  const data = await pagerdutyGet<{
    oncalls?: Array<{
      user?: { id?: string; summary?: string };
      schedule?: { id?: string; summary?: string };
      escalation_policy?: { id?: string; summary?: string };
      escalation_level?: number;
      start?: string;
      end?: string;
    }>;
  }>('/oncalls', config, credentials, fetchFn, queryParams);

  const oncalls = data.oncalls ?? [];
  return {
    oncalls: oncalls.map((o) => ({
      user: o.user?.summary ?? null,
      schedule: o.schedule?.summary ?? null,
      escalationPolicy: o.escalation_policy?.summary ?? null,
      escalationLevel: o.escalation_level ?? null,
      start: o.start ?? null,
      end: o.end ?? null,
    })),
    count: oncalls.length,
  };
};

// --- Pack definition ---

export const pagerdutyPack: IntegrationPack = {
  manifest: {
    name: 'pagerduty',
    type: 'integration',
    version: '0.1.0',
    description:
      'PagerDuty — incidents, services, on-call schedules',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'incidents.list',
        description: 'List incidents with optional status, since, and until filters',
        capability: 'observe',
        params: {
          status: {
            type: 'string',
            description:
              'Filter by status (triggered, acknowledged, resolved)',
            required: false,
          },
          since: {
            type: 'string',
            description: 'Start date (ISO 8601)',
            required: false,
          },
          until: {
            type: 'string',
            description: 'End date (ISO 8601)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'incidents.triggered',
        description: 'List active incidents (triggered + acknowledged)',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'services.list',
        description: 'List services with status',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'service.detail',
        description: 'Service detail with integrations and escalation policy',
        capability: 'observe',
        params: {
          id: {
            type: 'string',
            description: 'Service ID',
            required: true,
          },
        },
        timeout: 15000,
      },
      {
        name: 'oncall.list',
        description: 'Current on-call schedules',
        capability: 'observe',
        params: {
          schedule_ids: {
            type: 'string',
            description: 'Comma-separated schedule IDs to filter',
            required: false,
          },
        },
        timeout: 15000,
      },
    ],
    runbook: {
      category: 'itsm',
      probes: ['incidents.triggered', 'services.list'],
      parallel: true,
    },
  },

  handlers: {
    'incidents.list': incidentsList,
    'incidents.triggered': incidentsTriggered,
    'services.list': servicesList,
    'service.detail': serviceDetail,
    'oncall.list': oncallList,
  },

  testConnection: async (config, credentials, fetchFn) => {
    const url = `${config.endpoint.replace(/\/$/, '')}/abilities`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...buildAuthHeaders(credentials),
      ...config.headers,
    };

    const res = await fetchFn(url, { headers });
    return res.ok;
  },
};
