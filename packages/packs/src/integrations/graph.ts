import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Token cache ---

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: CachedToken | null = null;

/** Acquire or reuse a Graph OAuth2 token via client_credentials grant */
export async function ensureGraphToken(
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 30_000) {
    return tokenCache.accessToken;
  }

  const tenantId = credentials.credentials.tenantId ?? '';
  const clientId = credentials.credentials.clientId ?? '';
  const clientSecret = credentials.credentials.clientSecret ?? '';
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetchFn(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Graph token request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return tokenCache.accessToken;
}

/** Clear the cached token (used for testing) */
export function clearTokenCache(): void {
  tokenCache = null;
}

// --- Graph API helpers ---

interface GraphResponse {
  value: unknown[];
  '@odata.nextLink'?: string;
}

/** Fetch a Graph API endpoint with pagination */
export async function graphFetch(
  path: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
  queryParams?: Record<string, string>,
  maxPages = 5,
): Promise<unknown[]> {
  const token = await ensureGraphToken(credentials, fetchFn);
  const baseUrl = `${config.endpoint.replace(/\/$/, '')}${path}`;
  const url = new URL(baseUrl);
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...config.headers,
  };

  const results: unknown[] = [];
  let nextUrl: string | undefined = url.toString();
  let page = 0;

  while (nextUrl && page < maxPages) {
    const res = await fetchFn(nextUrl, { headers });
    if (!res.ok) throw new Error(`Graph API returned ${res.status}: ${res.statusText}`);
    const data = (await res.json()) as GraphResponse;
    results.push(...(data.value ?? []));
    nextUrl = data['@odata.nextLink'];
    page++;
  }

  return results;
}

/** Fetch a Graph API endpoint with 403 handling for Intune endpoints */
async function graphFetchIntune(
  path: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
  queryParams?: Record<string, string>,
  maxPages = 5,
): Promise<unknown[]> {
  try {
    return await graphFetch(path, config, credentials, fetchFn, queryParams, maxPages);
  } catch (error) {
    if (error instanceof Error && error.message.includes('403')) {
      throw new Error(
        'Intune license or permissions required. Ensure the app registration has DeviceManagementManagedDevices.Read.All permission and an Intune license is active.',
      );
    }
    throw error;
  }
}

// --- Probe handlers ---

const userLookup: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const q = (params?.q as string) ?? '';
  if (!q) throw new Error('q parameter is required (name, email, or UPN)');

  const filter = `startsWith(displayName,'${q}') or mail eq '${q}' or userPrincipalName eq '${q}'`;
  const select =
    'id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation,accountEnabled';

  const items = await graphFetch(
    '/users',
    config,
    credentials,
    fetchFn,
    { $filter: filter, $select: select },
    1,
  );

  return { users: items, count: items.length };
};

const userGroups: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const userId = (params?.id as string) ?? '';
  if (!userId) throw new Error('id parameter is required (user object ID or UPN)');

  const items = (await graphFetch(`/users/${userId}/memberOf`, config, credentials, fetchFn, {
    $select: 'id,displayName',
  })) as Array<Record<string, unknown>>;

  const groups = items.filter(
    (item) => (item['@odata.type'] as string) === '#microsoft.graph.group',
  );

  return {
    groups: groups.map((g) => ({ id: g.id, displayName: g.displayName })),
    count: groups.length,
  };
};

const signinRecent: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const user = (params?.user as string) ?? '';
  if (!user) throw new Error('user parameter is required (UPN)');

  const hours = (params?.hours as number) || 24;
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const filter = `userPrincipalName eq '${user}' and createdDateTime ge ${cutoff}`;
  const select =
    'createdDateTime,appDisplayName,ipAddress,status,location,deviceDetail,riskLevelDuringSignIn';

  const items = await graphFetch('/auditLogs/signIns', config, credentials, fetchFn, {
    $filter: filter,
    $select: select,
  });

  return { signIns: items, count: items.length, periodHours: hours };
};

const usersRisky: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const level = (params?.level as string) || 'high';
  const filter = `riskLevel eq '${level}'`;
  const select =
    'id,userDisplayName,userPrincipalName,riskLevel,riskState,riskDetail,riskLastUpdatedDateTime';

  const items = await graphFetch('/identityProtection/riskyUsers', config, credentials, fetchFn, {
    $filter: filter,
    $select: select,
  });

  return { riskyUsers: items, count: items.length, riskLevel: level };
};

const intuneDevicesCompliance: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const user = params?.user as string | undefined;
  const select =
    'id,deviceName,operatingSystem,osVersion,complianceState,lastSyncDateTime,userPrincipalName,model,manufacturer';
  const queryParams: Record<string, string> = { $select: select };

  if (user) {
    queryParams.$filter = `userPrincipalName eq '${user}'`;
  }

  const items = await graphFetchIntune(
    '/deviceManagement/managedDevices',
    config,
    credentials,
    fetchFn,
    queryParams,
  );

  return { devices: items, count: items.length };
};

const intuneDevicesNoncompliant: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  const select =
    'id,deviceName,operatingSystem,osVersion,complianceState,lastSyncDateTime,userPrincipalName,model,manufacturer';

  const items = await graphFetchIntune(
    '/deviceManagement/managedDevices',
    config,
    credentials,
    fetchFn,
    { $filter: "complianceState eq 'noncompliant'", $select: select },
  );

  return { devices: items, count: items.length };
};

const intuneAppsStatus: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const apps = (await graphFetchIntune(
    '/deviceAppManagement/mobileApps',
    config,
    credentials,
    fetchFn,
    { $select: 'id,displayName,publisher' },
  )) as Array<Record<string, unknown>>;

  const token = await ensureGraphToken(credentials, fetchFn);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...config.headers,
  };

  const appsWithStatus = await Promise.all(
    apps.map(async (app) => {
      try {
        const summaryUrl = `${config.endpoint.replace(/\/$/, '')}/deviceAppManagement/mobileApps/${app.id}/installSummary`;
        const res = await fetchFn(summaryUrl, { headers });
        if (res.ok) {
          const summary = (await res.json()) as Record<string, unknown>;
          return { ...app, installSummary: summary };
        }
        return { ...app, installSummary: null };
      } catch {
        return { ...app, installSummary: null };
      }
    }),
  );

  return { apps: appsWithStatus, count: appsWithStatus.length };
};

// --- Pack definition ---

export const graphPack: IntegrationPack = {
  manifest: {
    name: 'graph',
    type: 'integration',
    version: '0.1.0',
    description:
      'Microsoft Graph — Entra ID users, sign-in logs, risky users, Intune device compliance',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'user.lookup',
        description: 'Look up Entra ID users by name, email, or UPN',
        capability: 'observe',
        params: {
          q: {
            type: 'string',
            description: 'Search query (display name prefix, email, or UPN)',
            required: true,
          },
        },
        timeout: 15000,
      },
      {
        name: 'user.groups',
        description: 'List group memberships for a user',
        capability: 'observe',
        params: {
          id: {
            type: 'string',
            description: 'User object ID or UPN',
            required: true,
          },
        },
        timeout: 15000,
      },
      {
        name: 'signin.recent',
        description: 'Recent sign-in logs for a user',
        capability: 'observe',
        params: {
          user: {
            type: 'string',
            description: 'User principal name (UPN)',
            required: true,
          },
          hours: {
            type: 'number',
            description: 'Lookback period in hours (default: 24)',
            required: false,
          },
        },
        timeout: 30000,
      },
      {
        name: 'users.risky',
        description: 'Users flagged by Identity Protection at a given risk level',
        capability: 'observe',
        params: {
          level: {
            type: 'string',
            description: "Risk level filter: 'low', 'medium', or 'high' (default: 'high')",
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'intune.devices.compliance',
        description: 'Intune managed device compliance status',
        capability: 'observe',
        params: {
          user: {
            type: 'string',
            description: 'Optional UPN filter — if omitted, returns all managed devices',
            required: false,
          },
        },
        timeout: 30000,
      },
      {
        name: 'intune.devices.noncompliant',
        description: 'Intune devices with noncompliant status',
        capability: 'observe',
        params: {},
        timeout: 30000,
      },
      {
        name: 'intune.apps.status',
        description: 'Intune mobile app inventory with install summaries',
        capability: 'observe',
        params: {},
        timeout: 30000,
      },
    ],
    runbook: {
      category: 'identity',
      probes: ['user.lookup', 'users.risky', 'intune.devices.noncompliant'],
      parallel: true,
    },
  },

  handlers: {
    'user.lookup': userLookup,
    'user.groups': userGroups,
    'signin.recent': signinRecent,
    'users.risky': usersRisky,
    'intune.devices.compliance': intuneDevicesCompliance,
    'intune.devices.noncompliant': intuneDevicesNoncompliant,
    'intune.apps.status': intuneAppsStatus,
  },

  testConnection: async (config, credentials, fetchFn) => {
    try {
      const token = await ensureGraphToken(credentials, fetchFn);
      const url = `${config.endpoint.replace(/\/$/, '')}/organization?$select=id&$top=1`;
      const res = await fetchFn(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...config.headers,
        },
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};
