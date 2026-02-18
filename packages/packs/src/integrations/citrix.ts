import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Enum mappings (Citrix OData uses integer keys) ---

const CONNECTION_STATE: Record<number, string> = {
  0: 'Unknown',
  1: 'Connected',
  2: 'Disconnected',
  3: 'Disconnected',
  4: 'Preparing',
  5: 'Active',
};

const REGISTRATION_STATE: Record<number, string> = {
  0: 'Unregistered',
  1: 'Registered',
  2: 'AgentError',
};

const POWER_STATE: Record<number, string> = {
  0: 'Unmanaged',
  1: 'Unknown',
  2: 'Unavailable',
  3: 'Off',
  4: 'On',
  5: 'Suspended',
  6: 'TurningOn',
  7: 'TurningOff',
};

const FAULT_STATE: Record<number, string> = {
  0: 'None',
  1: 'FailedToStart',
  2: 'StuckOnBoot',
  3: 'Unregistered',
  4: 'MaxCapacity',
};

const FAILURE_CATEGORY: Record<number, string> = {
  0: 'None',
  1: 'ClientConnectionFailure',
  2: 'ClientError',
  3: 'CommunicationError',
  4: 'ConnectionTimeout',
  5: 'LicensingFailure',
  6: 'TicketingFailure',
  7: 'Other',
  8: 'Unknown',
};

// --- Cloud token cache ---

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: CachedToken | null = null;

/** Acquire or reuse a Citrix Cloud OAuth2 token via client_credentials grant */
export async function ensureAccessToken(
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 30_000) {
    return tokenCache.accessToken;
  }

  const customerId = credentials.credentials.customerId ?? '';
  const clientId = credentials.credentials.clientId ?? '';
  const clientSecret = credentials.credentials.clientSecret ?? '';
  const tokenUrl = `https://api.cloud.com/cctrustoauth2/${customerId}/tokens/clients`;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetchFn(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Citrix Cloud token request failed: ${res.status} ${res.statusText}`);
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

// --- Auth & URL helpers ---

/** Build auth headers: Basic for on-prem (api_key), CWSAuth for cloud (oauth2) */
export function buildAuthHeaders(
  credentials: IntegrationCredentials,
  cloudToken?: string,
): Record<string, string> {
  if (credentials.authMethod === 'oauth2') {
    const headers: Record<string, string> = {
      Authorization: `CWSAuth bearer=${cloudToken ?? ''}`,
      'Citrix-CustomerId': credentials.credentials.customerId ?? '',
    };
    return headers;
  }

  // api_key = on-prem Director with DOMAIN\username:password Basic auth
  const { domain, username, password } = credentials.credentials;
  const user = domain ? `${domain}\\${username}` : username;
  if (user && password) {
    return { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` };
  }
  return {};
}

/** Build OData URL: on-prem appends /Citrix/Monitor/OData/v4/Data, cloud uses endpoint directly */
export function buildODataUrl(endpoint: string, authMethod: string, entity: string): string {
  if (authMethod === 'oauth2') {
    // Cloud: endpoint is e.g. https://api.cloud.com/monitorodata
    return `${endpoint.replace(/\/$/, '')}/${entity}`;
  }
  // On-prem: append OData path
  return `${endpoint.replace(/\/$/, '')}/Citrix/Monitor/OData/v4/Data/${entity}`;
}

// --- OData pagination ---

interface ODataResponse {
  value: unknown[];
  '@odata.nextLink'?: string;
}

/** Fetch all pages of an OData response, following @odata.nextLink */
export async function fetchAllPages(
  url: string,
  headers: Record<string, string>,
  fetchFn: FetchFn,
  maxPages = 10,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let nextUrl: string | undefined = url;
  let page = 0;

  while (nextUrl && page < maxPages) {
    const res = await fetchFn(nextUrl, { headers: { Accept: 'application/json', ...headers } });
    if (!res.ok) throw new Error(`Citrix OData API returned ${res.status}: ${res.statusText}`);
    const data = (await res.json()) as ODataResponse;
    results.push(...(data.value ?? []));
    nextUrl = data['@odata.nextLink'];
    page++;
  }

  return results;
}

// --- Combined fetch helper ---

async function citrixFetch(
  entity: string,
  odataParams: Record<string, string>,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
  maxPages = 10,
): Promise<unknown[]> {
  let cloudToken: string | undefined;
  if (credentials.authMethod === 'oauth2') {
    cloudToken = await ensureAccessToken(credentials, fetchFn);
  }

  const baseUrl = buildODataUrl(config.endpoint, credentials.authMethod, entity);
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(odataParams)) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {
    ...buildAuthHeaders(credentials, cloudToken),
    ...config.headers,
  };

  return fetchAllPages(url.toString(), headers, fetchFn, maxPages);
}

// --- Helpers ---

/** Calculate duration in ms from timestamp pair, or use existing duration field */
function calcDuration(
  item: Record<string, unknown>,
  durationKey: string,
  startKey: string,
  endKey: string,
): number | null {
  const dur = item[durationKey];
  if (typeof dur === 'number' && dur > 0) return dur;
  const start = item[startKey];
  const end = item[endKey];
  if (typeof start === 'string' && typeof end === 'string') {
    const diff = new Date(end).getTime() - new Date(start).getTime();
    return diff >= 0 ? diff : null;
  }
  return null;
}

function mapEnum(value: unknown, mapping: Record<number, string>): string {
  if (typeof value === 'number') return mapping[value] ?? `Unknown(${value})`;
  return String(value ?? 'Unknown');
}

// --- Probe handlers ---

const sessionsActive: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const items = (await citrixFetch(
    'Sessions',
    { $filter: 'EndDate eq null', $expand: 'Machine,DesktopGroup' },
    config,
    credentials,
    fetchFn,
  )) as Array<Record<string, unknown>>;

  // Group by delivery group
  const groups: Record<string, { active: number; disconnected: number; total: number }> = {};
  for (const s of items) {
    const dg = (s.DesktopGroup as Record<string, unknown>)?.Name ?? 'Unknown';
    const dgName = String(dg);
    if (!groups[dgName]) groups[dgName] = { active: 0, disconnected: 0, total: 0 };
    const state = s.ConnectionState as number;
    if (state === 5) groups[dgName].active++;
    else if (state === 3) groups[dgName].disconnected++;
    groups[dgName].total++;
  }

  return {
    totalSessions: items.length,
    byDeliveryGroup: Object.entries(groups).map(([name, counts]) => ({
      deliveryGroup: name,
      ...counts,
    })),
  };
};

const sessionsFailures: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const hours = (params?.hours as number) || 24;
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const items = (await citrixFetch(
    'Connections',
    {
      $filter: `FailureDate ne null and LogOnStartDate ge datetime'${cutoff}'`,
    },
    config,
    credentials,
    fetchFn,
  )) as Array<Record<string, unknown>>;

  // Count by FailureCategory
  const byCategory: Record<string, number> = {};
  const affectedUsers = new Set<string>();
  const affectedMachines = new Set<string>();

  for (const c of items) {
    const cat = mapEnum(c.FailureCategory, FAILURE_CATEGORY);
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    if (c.UserName) affectedUsers.add(String(c.UserName));
    if (c.MachineName) affectedMachines.add(String(c.MachineName));
  }

  return {
    totalFailures: items.length,
    periodHours: hours,
    byCategory,
    affectedUsers: [...affectedUsers],
    affectedMachines: [...affectedMachines],
  };
};

const logonPerformance: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const hours = (params?.hours as number) || 24;
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const items = (await citrixFetch(
    'Sessions',
    {
      $filter: `LogOnDuration ne null and StartDate ge datetime'${cutoff}'`,
      $expand: 'DesktopGroup',
    },
    config,
    credentials,
    fetchFn,
  )) as Array<Record<string, unknown>>;

  // Aggregate by delivery group
  const groups: Record<
    string,
    {
      count: number;
      totalLogon: number;
      totalBrokering: number;
      totalVM: number;
    }
  > = {};

  for (const s of items) {
    const dgName = String((s.DesktopGroup as Record<string, unknown>)?.Name ?? 'Unknown');
    if (!groups[dgName]) {
      groups[dgName] = { count: 0, totalLogon: 0, totalBrokering: 0, totalVM: 0 };
    }
    const g = groups[dgName];
    g.count++;
    const logon = calcDuration(s, 'LogOnDuration', 'LogOnStartDate', 'LogOnEndDate');
    const brokering = calcDuration(s, 'BrokeringDuration', 'BrokeringDate', 'BrokeringDateEndDate');
    const vm = calcDuration(s, 'VMStartStartDate', 'VMStartStartDate', 'VMStartEndDate');
    if (logon !== null) g.totalLogon += logon;
    if (brokering !== null) g.totalBrokering += brokering;
    if (vm !== null) g.totalVM += vm;
  }

  return {
    periodHours: hours,
    totalSessions: items.length,
    byDeliveryGroup: Object.entries(groups).map(([name, g]) => ({
      deliveryGroup: name,
      sessionCount: g.count,
      avgLogonDurationMs: g.count > 0 ? Math.round(g.totalLogon / g.count) : 0,
      avgBrokeringDurationMs: g.count > 0 ? Math.round(g.totalBrokering / g.count) : 0,
      avgVMStartDurationMs: g.count > 0 ? Math.round(g.totalVM / g.count) : 0,
    })),
  };
};

const machinesStatus: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const items = (await citrixFetch(
    'Machines',
    { $filter: 'LifecycleState eq 0' },
    config,
    credentials,
    fetchFn,
  )) as Array<Record<string, unknown>>;

  return items.map((m) => ({
    name: m.DnsName ?? m.Name,
    registrationState: mapEnum(m.CurrentRegistrationState, REGISTRATION_STATE),
    powerState: mapEnum(m.CurrentPowerState, POWER_STATE),
    faultState: mapEnum(m.FaultState, FAULT_STATE),
    inMaintenanceMode: m.IsInMaintenanceMode ?? false,
    currentLoadIndex: m.CurrentLoadIndex ?? null,
    osType: m.OSType ?? null,
    agentVersion: m.AgentVersion ?? null,
    ipAddress: m.IPAddress ?? null,
  }));
};

const machinesLoad: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const items = (await citrixFetch(
    'Machines',
    { $filter: 'LifecycleState eq 0 and CurrentRegistrationState eq 1' },
    config,
    credentials,
    fetchFn,
  )) as Array<Record<string, unknown>>;

  // Sort by load index descending
  // CurrentLoadIndex: 0-10000 scale (10000 = fully loaded). Divide by 100 for percentage.
  const sorted = items
    .map((m) => {
      const loadIndex = (m.CurrentLoadIndex as number) ?? 0;
      return {
        name: m.DnsName ?? m.Name,
        currentLoadIndex: loadIndex,
        capacityPct: Math.round(loadIndex / 100),
        activeSessions: m.CurrentSessionCount ?? 0,
        inMaintenanceMode: m.IsInMaintenanceMode ?? false,
      };
    })
    .sort((a, b) => (b.currentLoadIndex as number) - (a.currentLoadIndex as number));

  return {
    totalRegistered: items.length,
    machines: sorted,
  };
};

const deliverygroupsHealth: IntegrationProbeHandler = async (
  _params,
  config,
  credentials,
  fetchFn,
) => {
  // Three parallel queries: DesktopGroups, Machines, Sessions (active)
  const [desktopGroups, machines, sessions] = await Promise.all([
    citrixFetch('DesktopGroups', {}, config, credentials, fetchFn),
    citrixFetch('Machines', { $filter: 'LifecycleState eq 0' }, config, credentials, fetchFn),
    citrixFetch('Sessions', { $filter: 'EndDate eq null' }, config, credentials, fetchFn),
  ]);

  const dgList = desktopGroups as Array<Record<string, unknown>>;
  const machineList = machines as Array<Record<string, unknown>>;
  const sessionList = sessions as Array<Record<string, unknown>>;

  // Index machines and sessions by DesktopGroupId
  const machinesByDg: Record<string, Array<Record<string, unknown>>> = {};
  for (const m of machineList) {
    const dgId = String(m.DesktopGroupId ?? '');
    if (!machinesByDg[dgId]) machinesByDg[dgId] = [];
    machinesByDg[dgId].push(m);
  }

  const sessionsByDg: Record<string, number> = {};
  for (const s of sessionList) {
    const dgId = String(s.DesktopGroupId ?? '');
    sessionsByDg[dgId] = (sessionsByDg[dgId] ?? 0) + 1;
  }

  return dgList.map((dg) => {
    const dgId = String(dg.Id ?? '');
    const dgMachines = machinesByDg[dgId] ?? [];
    const registered = dgMachines.filter(
      (m) => (m.CurrentRegistrationState as number) === 1,
    ).length;
    const maintenance = dgMachines.filter((m) => m.IsInMaintenanceMode === true).length;

    return {
      name: dg.Name,
      totalMachines: dgMachines.length,
      registeredMachines: registered,
      unregisteredMachines: dgMachines.length - registered,
      maintenanceMode: maintenance,
      activeSessions: sessionsByDg[dgId] ?? 0,
      enabled: dg.Enabled ?? true,
    };
  });
};

// --- Pack definition ---

export const citrixPack: IntegrationPack = {
  manifest: {
    name: 'citrix',
    type: 'integration',
    version: '0.1.0',
    description:
      'Citrix Monitor OData — sessions, logon performance, machine status, and delivery group health',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'sessions.active',
        description: 'Active and disconnected sessions grouped by delivery group',
        capability: 'observe',
        params: {},
        timeout: 30000,
      },
      {
        name: 'sessions.failures',
        description: 'Session connection failures with affected users and machines',
        capability: 'observe',
        params: {
          hours: {
            type: 'number',
            description: 'Lookback period in hours (default: 24)',
            required: false,
          },
        },
        timeout: 30000,
      },
      {
        name: 'logon.performance',
        description: 'Average logon duration breakdown per delivery group',
        capability: 'observe',
        params: {
          hours: {
            type: 'number',
            description: 'Lookback period in hours (default: 24)',
            required: false,
          },
        },
        timeout: 30000,
      },
      {
        name: 'machines.status',
        description: 'Machine registration, power, and fault state with human-readable names',
        capability: 'observe',
        params: {},
        timeout: 30000,
      },
      {
        name: 'machines.load',
        description: 'Registered machines sorted by load index with capacity percentage',
        capability: 'observe',
        params: {},
        timeout: 30000,
      },
      {
        name: 'deliverygroups.health',
        description: 'Per-delivery-group health: machines, registration, maintenance, sessions',
        capability: 'observe',
        params: {},
        timeout: 30000,
      },
    ],
    runbook: {
      category: 'citrix',
      probes: ['sessions.active', 'machines.status', 'deliverygroups.health'],
      parallel: true,
    },
  },

  handlers: {
    'sessions.active': sessionsActive,
    'sessions.failures': sessionsFailures,
    'logon.performance': logonPerformance,
    'machines.status': machinesStatus,
    'machines.load': machinesLoad,
    'deliverygroups.health': deliverygroupsHealth,
  },

  testConnection: async (config, credentials, fetchFn) => {
    let cloudToken: string | undefined;
    if (credentials.authMethod === 'oauth2') {
      cloudToken = await ensureAccessToken(credentials, fetchFn);
    }

    const url = buildODataUrl(config.endpoint, credentials.authMethod, 'Machines');
    const parsed = new URL(url);
    parsed.searchParams.set('$top', '1');
    parsed.searchParams.set('$select', 'Id');

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...buildAuthHeaders(credentials, cloudToken),
      ...config.headers,
    };

    const res = await fetchFn(parsed.toString(), { headers });
    return res.ok;
  },
};
