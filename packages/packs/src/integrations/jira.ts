import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Auth helpers ---

/** Build Basic auth header from email + API token */
function buildAuthHeaders(credentials: IntegrationCredentials): Record<string, string> {
  const email = credentials.credentials.email ?? '';
  const apiToken = credentials.credentials.apiToken ?? '';
  if (email && apiToken) {
    const encoded = Buffer.from(`${email}:${apiToken}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }
  return {};
}

// --- REST helper ---

async function jiraGet<T>(
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
    throw new Error(`Jira API returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// --- Probe handlers ---

const issuesSearch: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const jql = params?.jql as string;
  if (!jql) throw new Error('jql parameter is required');

  const maxResults = (params?.max_results as number) || 50;
  const queryParams: Record<string, string> = {
    jql,
    maxResults: String(maxResults),
  };

  const data = await jiraGet<{
    issues?: Array<{
      key: string;
      fields?: {
        summary?: string;
        status?: { name?: string };
        priority?: { name?: string };
        assignee?: { displayName?: string };
        created?: string;
        updated?: string;
        issuetype?: { name?: string };
      };
    }>;
    total?: number;
  }>('/rest/api/3/search/jql', config, credentials, fetchFn, queryParams);

  const issues = data.issues ?? [];
  return {
    issues: issues.map((i) => ({
      key: i.key,
      summary: i.fields?.summary ?? null,
      status: i.fields?.status?.name ?? null,
      priority: i.fields?.priority?.name ?? null,
      assignee: i.fields?.assignee?.displayName ?? null,
      issueType: i.fields?.issuetype?.name ?? null,
      created: i.fields?.created ?? null,
      updated: i.fields?.updated ?? null,
    })),
    total: data.total ?? issues.length,
    count: issues.length,
  };
};

const issueDetail: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const key = params?.key as string;
  if (!key) throw new Error('key parameter is required (e.g. PROJ-123)');

  return jiraGet(`/rest/api/3/issue/${key}`, config, credentials, fetchFn);
};

const issueChangelog: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const key = params?.key as string;
  if (!key) throw new Error('key parameter is required (e.g. PROJ-123)');

  const data = await jiraGet<{
    values?: Array<{
      id?: string;
      author?: { displayName?: string };
      created?: string;
      items?: Array<{
        field?: string;
        fromString?: string;
        toString?: string;
      }>;
    }>;
    total?: number;
  }>(`/rest/api/3/issue/${key}/changelog`, config, credentials, fetchFn);

  const entries = data.values ?? [];
  return {
    changelog: entries.map((e) => ({
      id: e.id ?? null,
      author: e.author?.displayName ?? null,
      created: e.created ?? null,
      items: (e.items ?? []).map((item) => ({
        field: item.field ?? null,
        from: item.fromString ?? null,
        to: item.toString ?? null,
      })),
    })),
    total: data.total ?? entries.length,
  };
};

const projectsList: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = await jiraGet<{
    values?: Array<{
      key: string;
      name: string;
      projectTypeKey?: string;
      style?: string;
    }>;
    total?: number;
  }>('/rest/api/3/project/search', config, credentials, fetchFn);

  const projects = data.values ?? [];
  return {
    projects: projects.map((p) => ({
      key: p.key,
      name: p.name,
      projectType: p.projectTypeKey ?? null,
      style: p.style ?? null,
    })),
    count: projects.length,
  };
};

const jiraHealth: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = await jiraGet<{
    baseUrl?: string;
    version?: string;
    deploymentType?: string;
    serverTitle?: string;
  }>('/rest/api/3/serverInfo', config, credentials, fetchFn);

  return {
    baseUrl: data.baseUrl ?? null,
    version: data.version ?? null,
    deploymentType: data.deploymentType ?? null,
    serverTitle: data.serverTitle ?? null,
  };
};

// --- Pack definition ---

export const jiraPack: IntegrationPack = {
  manifest: {
    name: 'jira',
    type: 'integration',
    version: '0.1.0',
    description: 'Atlassian Jira — issue search, details, changelog, and projects',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'issues.search',
        description: 'Search issues via JQL query',
        capability: 'observe',
        params: {
          jql: {
            type: 'string',
            description: 'JQL query (e.g. "project = PROJ AND status = Open")',
            required: true,
          },
          max_results: {
            type: 'number',
            description: 'Maximum results to return (default: 50)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'issue.detail',
        description: 'Get full issue details by key',
        capability: 'observe',
        params: {
          key: {
            type: 'string',
            description: 'Issue key (e.g. PROJ-123)',
            required: true,
          },
        },
        timeout: 15000,
      },
      {
        name: 'issue.changelog',
        description: 'Get change history for an issue',
        capability: 'observe',
        params: {
          key: {
            type: 'string',
            description: 'Issue key (e.g. PROJ-123)',
            required: true,
          },
        },
        timeout: 15000,
      },
      {
        name: 'projects.list',
        description: 'List all accessible projects',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'health',
        description: 'Jira server info and connectivity check',
        capability: 'observe',
        params: {},
        timeout: 10000,
      },
    ],
    runbook: {
      category: 'itsm',
      probes: ['health', 'projects.list'],
      parallel: true,
    },
  },

  handlers: {
    'issues.search': issuesSearch,
    'issue.detail': issueDetail,
    'issue.changelog': issueChangelog,
    'projects.list': projectsList,
    health: jiraHealth,
  },

  testConnection: async (config, credentials, fetchFn) => {
    const url = `${config.endpoint.replace(/\/$/, '')}/rest/api/3/serverInfo`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...buildAuthHeaders(credentials),
      ...config.headers,
    };

    const res = await fetchFn(url, { headers });
    return res.ok;
  },
};
