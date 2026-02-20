import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- OAuth2 client_credentials token cache ---

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: CachedToken | null = null;

/** Clear the cached token (used for testing) */
export function clearTokenCache(): void {
  tokenCache = null;
}

/**
 * Acquire or reuse a ServiceNow OAuth2 token via client_credentials grant.
 * Requires Washington DC release or newer with the OAuth 2.0 plugin enabled
 * and `glide.oauth.inbound.client.credential.grant_type.enabled = true`.
 * Token endpoint: POST https://<instance>/oauth_token.do
 */
async function ensureAccessToken(
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 30_000) {
    return tokenCache.accessToken;
  }

  const clientId = credentials.credentials.clientId ?? '';
  const clientSecret = credentials.credentials.clientSecret ?? '';
  const endpoint = config.endpoint.replace(/\/$/, '');

  const res = await fetchFn(`${endpoint}/oauth_token.do`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(
      `ServiceNow OAuth token request failed: ${res.status} ${res.statusText}`,
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return tokenCache.accessToken;
}

/** Build Authorization header based on auth method */
async function buildAuthHeaders(
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<Record<string, string>> {
  if (credentials.authMethod === 'oauth2') {
    const token = await ensureAccessToken(config, credentials, fetchFn);
    return { Authorization: `Bearer ${token}` };
  }
  const { username, password } = credentials.credentials;
  if (username && password) {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }
  return {};
}

/** Common query params for all ServiceNow Table API calls */
const COMMON_PARAMS = {
  sysparm_display_value: 'true',
  sysparm_exclude_reference_link: 'true',
  sysparm_limit: '1000',
};

/** Build a ServiceNow Table API URL */
function buildUrl(endpoint: string, table: string, query?: string, fields?: string[]): string {
  const url = new URL(`/api/now/table/${table}`, endpoint);
  for (const [key, value] of Object.entries(COMMON_PARAMS)) {
    url.searchParams.set(key, value);
  }
  if (query) url.searchParams.set('sysparm_query', query);
  if (fields?.length) url.searchParams.set('sysparm_fields', fields.join(','));
  return url.toString();
}

/** Fetch helper that adds auth headers and checks response */
async function snowFetch(
  url: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<{ result: unknown[] }> {
  const authHeaders = await buildAuthHeaders(config, credentials, fetchFn);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...authHeaders,
    ...config.headers,
  };
  const res = await fetchFn(url, { headers });
  if (!res.ok) throw new Error(`ServiceNow API returned ${res.status}: ${res.statusText}`);
  return (await res.json()) as { result: unknown[] };
}

/** Look up a CI's sys_id by name */
async function lookupSysId(
  name: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<string> {
  const url = buildUrl(config.endpoint, 'cmdb_ci_server', `name=${name}`, ['sys_id', 'name']);
  const data = await snowFetch(url, config, credentials, fetchFn);
  const results = data.result as Array<{ sys_id: string }>;
  const first = results[0];
  if (!first) throw new Error(`CI not found: ${name}`);
  return first.sys_id;
}

// --- Probe handlers ---

const ciLookup: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const query = params?.query as string;
  if (!query) throw new Error('query parameter is required');
  const type = (params?.type as string) || 'server';
  const table = `cmdb_ci_${type}`;
  const url = buildUrl(config.endpoint, table, `name=${query}^ORip_address=${query}`);
  const data = await snowFetch(url, config, credentials, fetchFn);
  return data.result;
};

const ciOwner: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const name = params?.name as string;
  if (!name) throw new Error('name parameter is required');
  const url = buildUrl(config.endpoint, 'cmdb_ci_server', `name=${name}`, [
    'name',
    'assigned_to',
    'support_group',
    'managed_by',
    'owned_by',
  ]);
  const data = await snowFetch(url, config, credentials, fetchFn);
  return data.result;
};

const ciRelationships: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const name = params?.name as string;
  if (!name) throw new Error('name parameter is required');
  const sysId = await lookupSysId(name, config, credentials, fetchFn);
  const url = buildUrl(config.endpoint, 'cmdb_rel_ci', `parent=${sysId}^ORchild=${sysId}`);
  const data = await snowFetch(url, config, credentials, fetchFn);
  return data.result;
};

const changesRecent: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const name = params?.name as string;
  if (!name) throw new Error('name parameter is required');
  const days = (params?.days as number) || 7;
  const sysId = await lookupSysId(name, config, credentials, fetchFn);
  const url = buildUrl(
    config.endpoint,
    'change_request',
    `cmdb_ci=${sysId}^sys_created_on>=javascript:gs.daysAgoStart(${days})`,
  );
  const data = await snowFetch(url, config, credentials, fetchFn);
  return data.result;
};

const incidentsOpen: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const name = params?.name as string;
  if (!name) throw new Error('name parameter is required');
  const url = buildUrl(config.endpoint, 'incident', `cmdb_ci.name=${name}^stateNOT IN6,7,8`);
  const data = await snowFetch(url, config, credentials, fetchFn);
  return data.result;
};

const serviceHealth: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const serviceName = params?.service_name as string;
  if (!serviceName) throw new Error('service_name parameter is required');
  // Get the service CI
  const serviceUrl = buildUrl(config.endpoint, 'cmdb_ci_service', `name=${serviceName}`);
  const serviceData = await snowFetch(serviceUrl, config, credentials, fetchFn);
  const services = serviceData.result as Array<{
    sys_id: string;
    name: string;
    operational_status: string;
  }>;
  const service = services[0];
  if (!service) throw new Error(`Service not found: ${serviceName}`);
  // Get child CIs via relationships
  const relUrl = buildUrl(config.endpoint, 'cmdb_rel_ci', `parent=${service.sys_id}`);
  const relData = await snowFetch(relUrl, config, credentials, fetchFn);
  return { service, children: relData.result };
};

const ciLifecycle: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const name = params?.name as string;
  if (!name) throw new Error('name parameter is required');
  const url = buildUrl(config.endpoint, 'cmdb_ci_server', `name=${name}`, [
    'name',
    'install_date',
    'warranty_expiration',
    'end_of_life',
    'asset_tag',
    'model_id',
  ]);
  const data = await snowFetch(url, config, credentials, fetchFn);
  return data.result;
};

export const servicenowPack: IntegrationPack = {
  manifest: {
    name: 'servicenow',
    type: 'integration',
    version: '0.1.0',
    description:
      'ServiceNow CMDB integration for CI lookup, ownership, incidents, and change tracking',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'ci.lookup',
        description: 'Look up a configuration item by name or IP address',
        capability: 'observe',
        params: {
          query: {
            type: 'string',
            description: 'CI name or IP address to search for',
            required: true,
          },
          type: {
            type: 'string',
            description: 'CI type (e.g. server, computer, linux_server). Defaults to server',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'ci.owner',
        description: 'Get ownership and support group information for a CI',
        capability: 'observe',
        params: {
          name: { type: 'string', description: 'CI name', required: true },
        },
        timeout: 15000,
      },
      {
        name: 'ci.relationships',
        description: 'Get all upstream and downstream relationships for a CI',
        capability: 'observe',
        params: {
          name: { type: 'string', description: 'CI name', required: true },
        },
        timeout: 15000,
      },
      {
        name: 'changes.recent',
        description: 'Get recent change requests associated with a CI',
        capability: 'observe',
        params: {
          name: { type: 'string', description: 'CI name', required: true },
          days: {
            type: 'number',
            description: 'Number of days to look back (default: 7)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'incidents.open',
        description: 'Get open incidents associated with a CI',
        capability: 'observe',
        params: {
          name: { type: 'string', description: 'CI name', required: true },
        },
        timeout: 15000,
      },
      {
        name: 'service.health',
        description: 'Get a business service and its child CIs',
        capability: 'observe',
        params: {
          service_name: { type: 'string', description: 'Business service name', required: true },
        },
        timeout: 15000,
      },
      {
        name: 'ci.lifecycle',
        description: 'Get lifecycle and asset information for a CI',
        capability: 'observe',
        params: {
          name: { type: 'string', description: 'CI name', required: true },
        },
        timeout: 15000,
      },
    ],
    runbook: {
      category: 'cmdb',
      probes: ['ci.lookup', 'ci.owner', 'incidents.open'],
      parallel: false,
    },
  },

  handlers: {
    'ci.lookup': ciLookup,
    'ci.owner': ciOwner,
    'ci.relationships': ciRelationships,
    'changes.recent': changesRecent,
    'incidents.open': incidentsOpen,
    'service.health': serviceHealth,
    'ci.lifecycle': ciLifecycle,
  },

  testConnection: async (config, credentials, fetchFn) => {
    const url = buildUrl(config.endpoint, 'sys_properties', undefined, ['name']);
    const parsed = new URL(url);
    parsed.searchParams.set('sysparm_limit', '1');
    const authHeaders = await buildAuthHeaders(config, credentials, fetchFn);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...authHeaders,
      ...config.headers,
    };
    const res = await fetchFn(parsed.toString(), { headers });
    return res.ok;
  },
};
