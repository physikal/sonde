import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Auth helpers ---

/** Build auth headers: Basic (username:password) or X-Ntnx-Api-Key */
export function buildAuthHeaders(credentials: IntegrationCredentials): Record<string, string> {
  if (credentials.authMethod === 'bearer_token') {
    const key = credentials.credentials.nutanixApiKey ?? '';
    return { 'X-Ntnx-Api-Key': key };
  }

  // basic auth (api_key method)
  const { username, password } = credentials.credentials;
  if (username && password) {
    return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
  }
  return {};
}

// --- Nutanix REST helpers ---

/** Build a full Nutanix Prism Central v4 URL */
export function nutanixUrl(
  endpoint: string,
  namespace: string,
  path: string,
  params?: Record<string, string>,
): string {
  const base = `${endpoint.replace(/\/$/, '')}/api/${namespace}/v4.0/${path}`;
  const url = new URL(base);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/** GET a Nutanix v4 endpoint, unwrap response envelope, return { data, totalCount } */
export async function nutanixGet(
  namespace: string,
  path: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
  params?: Record<string, string>,
): Promise<{ data: unknown; totalCount?: number }> {
  const url = nutanixUrl(config.endpoint, namespace, path, params);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...buildAuthHeaders(credentials),
    ...config.headers,
  };

  const res = await fetchFn(url, { headers });
  if (!res.ok) throw new Error(`Nutanix API returned ${res.status}: ${res.statusText}`);

  const body = (await res.json()) as {
    data?: unknown;
    metadata?: { totalAvailableResults?: number };
  };

  return {
    data: body.data,
    totalCount: body.metadata?.totalAvailableResults,
  };
}

/** POST to a Nutanix endpoint (used for v3 category query fallback) */
export async function nutanixPost(
  url: string,
  body: unknown,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...buildAuthHeaders(credentials),
    ...config.headers,
  };

  const res = await fetchFn(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Nutanix API returned ${res.status}: ${res.statusText}`);
  return res.json();
}

// --- Unit conversions ---

/** Convert parts-per-million to percentage (2 decimal places) */
export function ppmToPercent(ppm: number): number {
  return Math.round((ppm / 10000) * 100) / 100;
}

/** Convert microseconds to milliseconds (2 decimal places) */
export function usecsToMs(usecs: number): number {
  return Math.round((usecs / 1000) * 100) / 100;
}

// --- Probe handlers ---

const clustersList: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const name = params?.name as string | undefined;
  const queryParams: Record<string, string> = {};
  if (name) {
    queryParams.$filter = `name eq '${name}'`;
  }

  const { data, totalCount } = await nutanixGet(
    'clustermgmt',
    'config/clusters',
    config,
    credentials,
    fetchFn,
    queryParams,
  );

  const items = (data as Array<Record<string, unknown>>) ?? [];
  return {
    clusters: items.map((c) => ({
      name: c.name ?? null,
      extId: c.extId ?? null,
      hypervisorType:
        ((c.config as Record<string, unknown>)?.hypervisorType as string) ??
        (c.hypervisorType as string) ??
        null,
      aosVersion:
        ((c.config as Record<string, unknown>)?.buildInfo as Record<string, unknown>)?.version ??
        (c.aosVersion as string) ??
        null,
      numNodes:
        ((c.nodes as Record<string, unknown>)?.numberOfNodes as number) ??
        (c.numNodes as number) ??
        null,
      redundancyFactor:
        ((c.config as Record<string, unknown>)?.redundancyFactor as number) ??
        (c.redundancyFactor as number) ??
        null,
      operationMode: (c.operationMode as string) ?? null,
      isDegraded:
        (c.operationMode as string) !== undefined && (c.operationMode as string) !== 'NORMAL',
    })),
    totalCount: totalCount ?? items.length,
  };
};

const hostsList: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const clusterId = params?.cluster_id as string | undefined;
  const queryParams: Record<string, string> = {};
  if (clusterId) {
    queryParams.$filter = `clusterExtId eq '${clusterId}'`;
  }

  const { data, totalCount } = await nutanixGet(
    'clustermgmt',
    'config/hosts',
    config,
    credentials,
    fetchFn,
    queryParams,
  );

  const items = (data as Array<Record<string, unknown>>) ?? [];
  return {
    hosts: items.map((h) => ({
      name: (h.hostName as string) ?? (h.name as string) ?? null,
      extId: h.extId ?? null,
      serialNumber: (h.serialNumber as string) ?? null,
      blockModel: (h.blockModel as string) ?? null,
      hypervisorVersion:
        ((h.hypervisor as Record<string, unknown>)?.fullName as string) ??
        (h.hypervisorVersion as string) ??
        null,
      cpuModel: (h.cpuModel as string) ?? null,
      numCpuSockets: (h.numCpuSockets as number) ?? null,
      numCpuCores: (h.numCpuCores as number) ?? null,
      memoryCapacityBytes: (h.memoryCapacityBytes as number) ?? null,
      controllerVmIp:
        ((h.controllerVm as Record<string, unknown>)?.ip as string) ??
        (h.controllerVmIp as string) ??
        null,
      hypervisorIp:
        ((h.hypervisor as Record<string, unknown>)?.ip as string) ??
        (h.hypervisorIp as string) ??
        null,
      ipmiIp: ((h.ipmi as Record<string, unknown>)?.ip as string) ?? (h.ipmiIp as string) ?? null,
      maintenanceMode: (h.maintenanceMode as boolean) ?? false,
    })),
    totalCount: totalCount ?? items.length,
  };
};

const vmsList: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const name = params?.name as string | undefined;
  const powerState = params?.power_state as string | undefined;
  const clusterId = params?.cluster_id as string | undefined;
  const limit = (params?.limit as number) || 50;

  const filters: string[] = [];
  if (name) filters.push(`name eq '${name}'`);
  if (powerState) filters.push(`powerState eq '${powerState}'`);
  if (clusterId) filters.push(`clusterExtId eq '${clusterId}'`);

  const queryParams: Record<string, string> = { $limit: String(limit) };
  if (filters.length > 0) {
    queryParams.$filter = filters.join(' and ');
  }

  const { data, totalCount } = await nutanixGet(
    'vmm',
    'ahv/config/vms',
    config,
    credentials,
    fetchFn,
    queryParams,
  );

  const items = (data as Array<Record<string, unknown>>) ?? [];
  return {
    vms: items.map((v) => ({
      name: v.name ?? null,
      extId: v.extId ?? null,
      powerState: v.powerState ?? null,
      numSockets: v.numSockets ?? null,
      numCoresPerSocket: v.numCoresPerSocket ?? null,
      memorySizeMb:
        v.memorySizeBytes != null
          ? Math.round((v.memorySizeBytes as number) / 1048576)
          : ((v.memorySizeMb as number) ?? null),
      clusterExtId: (v.cluster as Record<string, unknown>)?.extId ?? v.clusterExtId ?? null,
      hostExtId: (v.host as Record<string, unknown>)?.extId ?? v.hostExtId ?? null,
      description: v.description ?? null,
      createTime: v.createTime ?? null,
    })),
    totalCount: totalCount ?? items.length,
  };
};

const vmDetail: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const vmId = params?.vm_id as string;
  if (!vmId) throw new Error('vm_id parameter is required');

  const { data } = await nutanixGet('vmm', `ahv/config/vms/${vmId}`, config, credentials, fetchFn);

  const vm = data as Record<string, unknown>;

  // Parse disks
  const disks = ((vm.disks as Array<Record<string, unknown>>) ?? []).map((d) => {
    const backing = (d.backingInfo as Record<string, unknown>) ?? {};
    return {
      diskAddress: d.diskAddress ?? null,
      deviceType: (backing.deviceType as string) ?? (d.deviceType as string) ?? null,
      storageContainerId: (backing.storageContainerId as string) ?? null,
      sizeBytes: (backing.diskSizeBytes as number) ?? (backing.vmDiskSize as number) ?? null,
    };
  });

  // Parse NICs
  const nics = ((vm.nics as Array<Record<string, unknown>>) ?? []).map((n) => {
    const network = (n.networkInfo as Record<string, unknown>) ?? {};
    const subnetRef = (network.subnet as Record<string, unknown>) ?? {};
    return {
      macAddress: (n.macAddress as string) ?? (network.macAddress as string) ?? null,
      subnetExtId: (subnetRef.extId as string) ?? (network.subnetExtId as string) ?? null,
      nicType: (network.nicType as string) ?? (n.nicType as string) ?? null,
      isConnected: (network.isConnected as boolean) ?? (n.isConnected as boolean) ?? null,
    };
  });

  // Total allocated storage
  const totalStorageBytes = disks.reduce((sum, d) => sum + ((d.sizeBytes as number) ?? 0), 0);

  return {
    name: vm.name ?? null,
    extId: vm.extId ?? null,
    powerState: vm.powerState ?? null,
    numSockets: vm.numSockets ?? null,
    numCoresPerSocket: vm.numCoresPerSocket ?? null,
    memorySizeMb:
      vm.memorySizeBytes != null
        ? Math.round((vm.memorySizeBytes as number) / 1048576)
        : ((vm.memorySizeMb as number) ?? null),
    description: vm.description ?? null,
    clusterExtId: (vm.cluster as Record<string, unknown>)?.extId ?? vm.clusterExtId ?? null,
    hostExtId: (vm.host as Record<string, unknown>)?.extId ?? vm.hostExtId ?? null,
    disks,
    nics,
    totalStorageBytes,
    bootConfig: vm.bootConfig ?? null,
    categories: vm.categories ?? null,
    guestTools: vm.guestTools ?? null,
    createTime: vm.createTime ?? null,
  };
};

const vmStats: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const vmId = params?.vm_id as string;
  if (!vmId) throw new Error('vm_id parameter is required');

  const { data } = await nutanixGet('vmm', `ahv/stats/vms/${vmId}`, config, credentials, fetchFn);

  const stats = (data as Array<Record<string, unknown>>) ?? [];

  const findStat = (metricType: string): number | null => {
    const entry = stats.find(
      (s) => s.metricType === metricType || (s.extId as string)?.includes(metricType.toLowerCase()),
    );
    return entry?.value != null ? (entry.value as number) : null;
  };

  const cpuPpm = findStat('CPU_USAGE_PPM') ?? findStat('hypervisor_cpu_usage_ppm');
  const memPpm = findStat('MEMORY_USAGE_PPM') ?? findStat('memory_usage_ppm');
  const iops = findStat('IOPS') ?? findStat('controller_num_iops');
  const bwKbps = findStat('IO_BANDWIDTH_KBPS') ?? findStat('controller_io_bandwidth_kBps');
  const latencyUsecs =
    findStat('AVG_IO_LATENCY_USECS') ?? findStat('controller_avg_io_latency_usecs');
  const rxBytes = findStat('NETWORK_RX_BYTES') ?? findStat('hypervisor_num_received_bytes');
  const txBytes = findStat('NETWORK_TX_BYTES') ?? findStat('hypervisor_num_transmitted_bytes');

  return {
    cpuUsagePct: cpuPpm != null ? ppmToPercent(cpuPpm) : null,
    memoryUsagePct: memPpm != null ? ppmToPercent(memPpm) : null,
    iops: iops ?? null,
    ioBandwidthKbps: bwKbps ?? null,
    avgIoLatencyMs: latencyUsecs != null ? usecsToMs(latencyUsecs) : null,
    networkRxBytes: rxBytes ?? null,
    networkTxBytes: txBytes ?? null,
  };
};

const alertsList: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const severity = params?.severity as string | undefined;
  const resolved = params?.resolved as boolean | undefined;
  const hours = params?.hours as number | undefined;
  const entityType = params?.entity_type as string | undefined;
  const limit = (params?.limit as number) || 50;

  const filters: string[] = [];
  if (severity) filters.push(`severity eq '${severity}'`);
  if (resolved === true) filters.push("resolvedStatus eq 'RESOLVED'");
  if (resolved === false) filters.push("resolvedStatus eq 'UNRESOLVED'");
  if (hours) {
    const since = new Date(Date.now() - hours * 3600000).toISOString();
    filters.push(`creationTime ge '${since}'`);
  }
  if (entityType) filters.push(`sourceEntity/type eq '${entityType}'`);

  const queryParams: Record<string, string> = { $limit: String(limit) };
  if (filters.length > 0) {
    queryParams.$filter = filters.join(' and ');
  }

  const { data, totalCount } = await nutanixGet(
    'monitoring',
    'alerts',
    config,
    credentials,
    fetchFn,
    queryParams,
  );

  const items = (data as Array<Record<string, unknown>>) ?? [];
  return {
    alerts: items.map((a) => {
      const source = (a.sourceEntity as Record<string, unknown>) ?? {};
      return {
        title: a.title ?? null,
        severity: a.severity ?? null,
        sourceEntity: {
          type: source.type ?? null,
          name: source.name ?? null,
          extId: source.extId ?? null,
        },
        creationTime: a.creationTime ?? null,
        description: a.description ?? null,
        resolvedStatus: a.resolvedStatus ?? null,
        impactType: a.impactType ?? null,
        possibleCauses: a.possibleCauses ?? null,
        resolutionSteps: a.resolutionSteps ?? null,
      };
    }),
    totalCount: totalCount ?? items.length,
  };
};

const alertsSummary: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const queryParams: Record<string, string> = { $limit: '500' };

  const { data } = await nutanixGet(
    'monitoring',
    'alerts',
    config,
    credentials,
    fetchFn,
    queryParams,
  );

  const items = (data as Array<Record<string, unknown>>) ?? [];

  const bySeverity: Record<string, number> = { CRITICAL: 0, WARNING: 0, INFO: 0 };
  const byEntityType: Record<string, number> = {};
  const unresolvedCritical: Array<{
    title: unknown;
    sourceEntity: unknown;
    creationTime: unknown;
  }> = [];

  for (const a of items) {
    const sev = (a.severity as string) ?? 'INFO';
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;

    const source = (a.sourceEntity as Record<string, unknown>) ?? {};
    const entityType = (source.type as string) ?? 'Unknown';
    byEntityType[entityType] = (byEntityType[entityType] ?? 0) + 1;

    if (sev === 'CRITICAL' && a.resolvedStatus !== 'RESOLVED') {
      unresolvedCritical.push({
        title: a.title,
        sourceEntity: { type: source.type, name: source.name, extId: source.extId },
        creationTime: a.creationTime,
      });
    }
  }

  return {
    bySeverity,
    byEntityType,
    unresolvedCritical,
    totalCount: items.length,
  };
};

const storageContainers: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const clusterId = params?.cluster_id as string | undefined;
  const queryParams: Record<string, string> = {};
  if (clusterId) {
    queryParams.$filter = `clusterExtId eq '${clusterId}'`;
  }

  const { data, totalCount } = await nutanixGet(
    'clustermgmt',
    'config/storage-containers',
    config,
    credentials,
    fetchFn,
    queryParams,
  );

  const items = (data as Array<Record<string, unknown>>) ?? [];
  return {
    containers: items.map((c) => {
      const max = (c.maxCapacity as number) ?? (c.maxCapacityBytes as number) ?? 0;
      const used = (c.usedCapacity as number) ?? (c.usedBytes as number) ?? 0;
      const reserved = (c.reservedCapacity as number) ?? (c.reservedCapacityBytes as number) ?? 0;
      const usedPct = max > 0 ? Math.round((used / max) * 10000) / 100 : 0;
      const available = max - used;

      return {
        name: c.name ?? null,
        extId: c.extId ?? null,
        maxCapacityBytes: max,
        usedBytes: used,
        reservedCapacityBytes: reserved,
        replicationFactor: c.replicationFactor ?? null,
        compressionEnabled: c.compressionEnabled ?? false,
        deduplicationEnabled:
          (c.onDiskDedup as string) === 'POST_PROCESS' ||
          (c.onDiskDedup as string) === 'INLINE' ||
          ((c.deduplicationEnabled as boolean) ?? false),
        erasureCodingEnabled: c.erasureCodingEnabled ?? false,
        usedPct,
        availableBytes: available,
        highUsage: usedPct > 85,
      };
    }),
    totalCount: totalCount ?? items.length,
  };
};

const categoriesList: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const key = params?.key as string | undefined;
  const queryParams: Record<string, string> = {};
  if (key) {
    queryParams.$filter = `key eq '${key}'`;
  }

  const { data, totalCount } = await nutanixGet(
    'prism',
    'config/categories',
    config,
    credentials,
    fetchFn,
    queryParams,
  );

  const items = (data as Array<Record<string, unknown>>) ?? [];
  return {
    categories: items.map((c) => ({
      key: c.key ?? null,
      value: c.value ?? null,
      description: c.description ?? null,
      type: c.type ?? null,
    })),
    totalCount: totalCount ?? items.length,
  };
};

const categoriesEntities: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const key = params?.key as string;
  const value = params?.value as string;
  if (!key) throw new Error('key parameter is required');
  if (!value) throw new Error('value parameter is required');

  const url = `${config.endpoint.replace(/\/$/, '')}/api/nutanix/v3/category/query`;
  const body = {
    usage_type: 'APPLIED_TO',
    category_filter: {
      type: 'CATEGORIES_MATCH_ANY',
      params: { [key]: [value] },
    },
  };

  const result = (await nutanixPost(url, body, config, credentials, fetchFn)) as {
    results?: Array<{
      kind?: string;
      kind_reference_list?: Array<{
        kind?: string;
        uuid?: string;
        name?: string;
      }>;
    }>;
  };

  const entities: Array<{ entityType: string; entityId: string; entityName: string | null }> = [];
  for (const group of result.results ?? []) {
    const entityType = group.kind ?? 'unknown';
    for (const ref of group.kind_reference_list ?? []) {
      entities.push({
        entityType,
        entityId: ref.uuid ?? '',
        entityName: ref.name ?? null,
      });
    }
  }

  return {
    entities,
    totalCount: entities.length,
  };
};

const networksList: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const clusterId = params?.cluster_id as string | undefined;
  const queryParams: Record<string, string> = {};
  if (clusterId) {
    queryParams.$filter = `clusterExtId eq '${clusterId}'`;
  }

  const { data, totalCount } = await nutanixGet(
    'networking',
    'config/subnets',
    config,
    credentials,
    fetchFn,
    queryParams,
  );

  const items = (data as Array<Record<string, unknown>>) ?? [];
  return {
    subnets: items.map((s) => {
      const ipConfig = (s.ipConfig as Record<string, unknown>) ?? {};
      const pool = ((ipConfig.ipv4Config as Record<string, unknown>) ?? ipConfig) as Record<
        string,
        unknown
      >;
      return {
        name: s.name ?? null,
        type: s.subnetType ?? s.type ?? null,
        vlanId: s.vlanId ?? null,
        networkIp: (pool.networkIp as string) ?? (pool.subnetIp as string) ?? null,
        prefixLength: (pool.prefixLength as number) ?? null,
        dhcpEnabled:
          (pool.dhcpServerAddress as unknown) != null || ((s.dhcpEnabled as boolean) ?? false),
        vpcRef: (s.vpcReference as Record<string, unknown>)?.extId ?? s.vpcRef ?? null,
        clusterExtId:
          (s.clusterReference as string) ??
          (s.cluster as Record<string, unknown>)?.extId ??
          s.clusterExtId ??
          null,
      };
    }),
    totalCount: totalCount ?? items.length,
  };
};

const tasksRecent: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const hours = (params?.hours as number) || 24;
  const status = params?.status as string | undefined;
  const limit = (params?.limit as number) || 50;

  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const filters: string[] = [`startTime ge '${since}'`];
  if (status) filters.push(`status eq '${status}'`);

  const queryParams: Record<string, string> = {
    $limit: String(limit),
    $filter: filters.join(' and '),
  };

  const { data, totalCount } = await nutanixGet(
    'prism',
    'config/tasks',
    config,
    credentials,
    fetchFn,
    queryParams,
  );

  const items = (data as Array<Record<string, unknown>>) ?? [];
  const now = Date.now();
  const oneHourMs = 3600000;

  return {
    tasks: items.map((t) => {
      const startTime = t.startTime as string | null;
      const endTime = (t.completedTime as string) ?? (t.endTime as string) ?? null;
      const isFailed = (t.status as string) === 'FAILED';
      const isLongRunning =
        !endTime && startTime && now - new Date(startTime).getTime() > oneHourMs;

      return {
        type: (t.operationType as string) ?? (t.type as string) ?? null,
        status: t.status ?? null,
        entityRef: t.entityReference ?? t.entityRef ?? null,
        startTime: startTime ?? null,
        endTime,
        errorMessage:
          (t.errorMessages as Array<Record<string, unknown>>)?.[0]?.message ??
          (t.errorMessage as string) ??
          null,
        progressPct: (t.progressPercentage as number) ?? (t.progressPct as number) ?? null,
        isFailed,
        isLongRunning: !!isLongRunning,
      };
    }),
    totalCount: totalCount ?? items.length,
  };
};

const clusterHealth: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const clusterId = params?.cluster_id as string | undefined;

  // Fetch cluster info
  let clusterInfo: Record<string, unknown> | null = null;
  if (clusterId) {
    const { data } = await nutanixGet(
      'clustermgmt',
      `config/clusters/${clusterId}`,
      config,
      credentials,
      fetchFn,
    );
    clusterInfo = data as Record<string, unknown>;
  } else {
    const { data } = await nutanixGet(
      'clustermgmt',
      'config/clusters',
      config,
      credentials,
      fetchFn,
      { $limit: '1' },
    );
    const clusters = (data as Array<Record<string, unknown>>) ?? [];
    clusterInfo = clusters[0] ?? null;
  }

  const cExtId = (clusterInfo?.extId as string) ?? clusterId;

  // Parallel fetches: hosts, critical alerts, storage
  const hostsFilter: Record<string, string> = {};
  if (cExtId) hostsFilter.$filter = `clusterExtId eq '${cExtId}'`;

  const storageFilter: Record<string, string> = {};
  if (cExtId) storageFilter.$filter = `clusterExtId eq '${cExtId}'`;

  const [hostsResult, alertsResult, storageResult] = await Promise.all([
    nutanixGet('clustermgmt', 'config/hosts', config, credentials, fetchFn, hostsFilter),
    nutanixGet('monitoring', 'alerts', config, credentials, fetchFn, {
      $filter: "severity eq 'CRITICAL' and resolvedStatus eq 'UNRESOLVED'",
      $limit: '100',
    }),
    nutanixGet(
      'clustermgmt',
      'config/storage-containers',
      config,
      credentials,
      fetchFn,
      storageFilter,
    ),
  ]);

  const hosts = (hostsResult.data as Array<Record<string, unknown>>) ?? [];
  const alerts = (alertsResult.data as Array<Record<string, unknown>>) ?? [];
  const containers = (storageResult.data as Array<Record<string, unknown>>) ?? [];

  const degradedNodes = hosts.filter(
    (h) => (h.maintenanceMode as boolean) === true || (h.status as string) === 'DEGRADED',
  );

  const storageContainersInfo = containers.map((c) => {
    const max = (c.maxCapacity as number) ?? (c.maxCapacityBytes as number) ?? 0;
    const used = (c.usedCapacity as number) ?? (c.usedBytes as number) ?? 0;
    return {
      name: c.name,
      usedPct: max > 0 ? Math.round((used / max) * 10000) / 100 : 0,
    };
  });

  const issues: string[] = [];
  if (degradedNodes.length > 0) {
    issues.push(`${degradedNodes.length} node(s) degraded or in maintenance`);
  }
  if (alerts.length > 0) {
    issues.push(`${alerts.length} unresolved critical alert(s)`);
  }
  for (const sc of storageContainersInfo) {
    if (sc.usedPct > 85) {
      issues.push(`Storage container ${sc.name} at ${sc.usedPct}% capacity`);
    }
  }

  let healthAssessment: string;
  if (alerts.length > 0 || degradedNodes.length > 0) {
    healthAssessment = 'CRITICAL';
  } else if (storageContainersInfo.some((sc) => sc.usedPct > 85)) {
    healthAssessment = 'WARNING';
  } else {
    healthAssessment = 'HEALTHY';
  }

  return {
    cluster: clusterInfo
      ? {
          name: clusterInfo.name,
          extId: clusterInfo.extId,
          operationMode: clusterInfo.operationMode,
        }
      : null,
    nodeCount: hosts.length,
    degradedNodes: degradedNodes.map((h) => ({
      name: h.hostName ?? h.name,
      extId: h.extId,
      maintenanceMode: h.maintenanceMode,
    })),
    criticalAlerts: alerts.map((a) => ({
      title: a.title,
      sourceEntity: a.sourceEntity,
      creationTime: a.creationTime,
    })),
    storageContainers: storageContainersInfo,
    healthAssessment,
    issues,
  };
};

const vmSnapshots: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const vmId = params?.vm_id as string;
  if (!vmId) throw new Error('vm_id parameter is required');

  // Try v4 dataprotection API first
  let items: Array<Record<string, unknown>> = [];
  let usedV3 = false;

  try {
    const { data } = await nutanixGet(
      'dataprotection',
      'config/recovery-points',
      config,
      credentials,
      fetchFn,
      { $filter: `vmExtId eq '${vmId}'` },
    );
    items = (data as Array<Record<string, unknown>>) ?? [];
  } catch {
    // Fall back to v3
    const url = `${config.endpoint.replace(/\/$/, '')}/api/nutanix/v3/vm_recovery_points/list`;
    const result = (await nutanixPost(
      url,
      { filter: `vm_uuid==${vmId}`, length: 100 },
      config,
      credentials,
      fetchFn,
    )) as { entities?: Array<Record<string, unknown>> };
    items = result.entities ?? [];
    usedV3 = true;
  }

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 3600000;

  const snapshots = items.map((rp) => {
    const name =
      (rp.name as string) ??
      (rp.status as Record<string, unknown>)?.name ??
      (rp.extId as string) ??
      null;
    const creationTime =
      (rp.creationTime as string) ?? (rp.status as Record<string, unknown>)?.creation_time ?? null;
    const expirationTime =
      (rp.expirationTime as string) ??
      (rp.status as Record<string, unknown>)?.expiration_time ??
      null;
    const consistencyType =
      (rp.recoveryPointType as string) ??
      (rp.status as Record<string, unknown>)?.recovery_point_type ??
      null;
    const sizeBytes = (rp.sizeBytes as number) ?? (rp.diskSizeBytes as number) ?? null;

    const createdMs = creationTime ? new Date(creationTime as string).getTime() : null;
    const ageMs = createdMs ? now - createdMs : null;
    const isOld = ageMs != null && ageMs > sevenDaysMs;

    const expirationMs = expirationTime ? new Date(expirationTime as string).getTime() : null;
    const isExpired = expirationMs != null && expirationMs < now;

    return {
      name,
      extId: rp.extId ?? null,
      creationTime,
      expirationTime,
      consistencyType,
      sizeBytes,
      ageDays: ageMs != null ? Math.round((ageMs / 86400000) * 10) / 10 : null,
      isOld,
      isExpired,
    };
  });

  const warnings: string[] = [];
  const oldSnapshots = snapshots.filter((s) => s.isOld);
  const expiredSnapshots = snapshots.filter((s) => s.isExpired);
  if (oldSnapshots.length > 0) {
    warnings.push(`${oldSnapshots.length} snapshot(s) older than 7 days`);
  }
  if (expiredSnapshots.length > 0) {
    warnings.push(`${expiredSnapshots.length} expired snapshot(s) not cleaned up`);
  }

  return { snapshots, totalCount: snapshots.length, usedV3, warnings };
};

const protectionPolicies: IntegrationProbeHandler = async (
  params,
  config,
  credentials,
  fetchFn,
) => {
  const vmId = params?.vm_id as string | undefined;

  const { data, totalCount } = await nutanixGet(
    'dataprotection',
    'config/protection-policies',
    config,
    credentials,
    fetchFn,
  );

  const items = (data as Array<Record<string, unknown>>) ?? [];

  const policies = items.map((p) => {
    const schedules = (p.schedules as Array<Record<string, unknown>>) ?? [];
    const primarySchedule = schedules[0];
    const rpo = primarySchedule
      ? {
          value: primarySchedule.recoveryPointObjective ?? primarySchedule.rpoInMinutes ?? null,
          unit: (primarySchedule.rpoUnit as string) ?? 'MINUTES',
        }
      : null;

    const retention = primarySchedule
      ? {
          local: (primarySchedule.localRetentionCount as number) ?? null,
          remote: (primarySchedule.remoteRetentionCount as number) ?? null,
        }
      : null;

    const protectedEntities =
      (p.protectedEntities as Array<Record<string, unknown>>) ??
      (p.entityReferences as Array<Record<string, unknown>>) ??
      [];

    return {
      name: p.name ?? null,
      extId: p.extId ?? null,
      description: p.description ?? null,
      rpo,
      retention,
      remoteSite: (p.remoteSiteReference as Record<string, unknown>)?.name ?? p.remoteSite ?? null,
      protectedEntityCount: protectedEntities.length,
      protectedEntityIds: protectedEntities.map(
        (e) => (e.extId as string) ?? (e.entityId as string) ?? '',
      ),
      lastSuccessfulReplication: p.lastSuccessfulReplicationTime ?? null,
    };
  });

  if (vmId) {
    const covering = policies.filter((p) => p.protectedEntityIds.includes(vmId));
    return {
      policies: covering,
      totalCount: covering.length,
      vmCovered: covering.length > 0,
      allPoliciesCount: policies.length,
    };
  }

  return { policies, totalCount: totalCount ?? policies.length };
};

const lifecycleStatus: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const { data, totalCount } = await nutanixGet(
    'lifecycle',
    'resources/entities',
    config,
    credentials,
    fetchFn,
  );

  const items = (data as Array<Record<string, unknown>>) ?? [];

  const entities = items.map((e) => {
    const availableVersion =
      (e.availableVersion as Record<string, unknown>)?.version ??
      (e.availableVersion as string) ??
      null;
    const currentVersion =
      (e.installedVersion as Record<string, unknown>)?.version ??
      (e.currentVersion as string) ??
      null;
    return {
      entityType: (e.entityType as string) ?? (e.entityModel as string) ?? null,
      name: e.name ?? null,
      extId: e.extId ?? null,
      currentVersion,
      availableVersion,
      updateStatus: (e.updateStatus as string) ?? null,
      hasUpdate: availableVersion != null && availableVersion !== currentVersion,
    };
  });

  const warnings: string[] = [];
  const updatable = entities.filter((e) => e.hasUpdate);
  if (updatable.length > 0) {
    warnings.push(`${updatable.length} component(s) have available updates`);
    for (const e of updatable) {
      warnings.push(`${e.entityType ?? e.name}: ${e.currentVersion} → ${e.availableVersion}`);
    }
  }

  return {
    entities,
    updatableCount: updatable.length,
    totalCount: totalCount ?? entities.length,
    warnings,
  };
};

const hostStats: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const hostId = params?.host_id as string;
  if (!hostId) throw new Error('host_id parameter is required');

  const { data } = await nutanixGet(
    'clustermgmt',
    `stats/hosts/${hostId}`,
    config,
    credentials,
    fetchFn,
  );

  const stats = (data as Array<Record<string, unknown>>) ?? [];

  const findStat = (metricType: string): number | null => {
    const entry = stats.find(
      (s) => s.metricType === metricType || (s.extId as string)?.includes(metricType.toLowerCase()),
    );
    return entry?.value != null ? (entry.value as number) : null;
  };

  const cpuPpm = findStat('HYPERVISOR_CPU_USAGE_PPM') ?? findStat('hypervisor_cpu_usage_ppm');
  const memPpm = findStat('HYPERVISOR_MEMORY_USAGE_PPM') ?? findStat('hypervisor_memory_usage_ppm');
  const iops = findStat('IOPS') ?? findStat('controller_num_iops');
  const bwKbps = findStat('IO_BANDWIDTH_KBPS') ?? findStat('controller_io_bandwidth_kBps');
  const networkRx = findStat('NETWORK_RX_BYTES') ?? findStat('hypervisor_num_received_bytes');
  const networkTx = findStat('NETWORK_TX_BYTES') ?? findStat('hypervisor_num_transmitted_bytes');
  const uptimeUsecs = findStat('HYPERVISOR_UPTIME_USECS') ?? findStat('hypervisor_uptime_usecs');

  const cpuPct = cpuPpm != null ? ppmToPercent(cpuPpm) : null;
  const memPct = memPpm != null ? ppmToPercent(memPpm) : null;

  const warnings: string[] = [];
  if (cpuPct != null && cpuPct > 85) {
    warnings.push(`Host CPU at ${cpuPct}%`);
  }
  if (memPct != null && memPct > 90) {
    warnings.push(`Host memory at ${memPct}%`);
  }

  return {
    cpuUsagePct: cpuPct,
    memoryUsagePct: memPct,
    iops: iops ?? null,
    ioBandwidthKbps: bwKbps ?? null,
    networkRxBytes: networkRx ?? null,
    networkTxBytes: networkTx ?? null,
    hypervisorUptimeUsecs: uptimeUsecs ?? null,
    warnings,
  };
};

const clusterStats: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const clusterId = params?.cluster_id as string;
  if (!clusterId) throw new Error('cluster_id parameter is required');

  const { data } = await nutanixGet(
    'clustermgmt',
    `stats/clusters/${clusterId}`,
    config,
    credentials,
    fetchFn,
  );

  const stats = (data as Array<Record<string, unknown>>) ?? [];

  const findStat = (metricType: string): number | null => {
    const entry = stats.find(
      (s) => s.metricType === metricType || (s.extId as string)?.includes(metricType.toLowerCase()),
    );
    return entry?.value != null ? (entry.value as number) : null;
  };

  const cpuCapacityHz = findStat('CPU_CAPACITY_HZ') ?? findStat('cpu_capacity_hz');
  const cpuUsedHz = findStat('CPU_USAGE_HZ') ?? findStat('hypervisor_cpu_usage_hz');
  const memCapacity = findStat('MEMORY_CAPACITY_BYTES') ?? findStat('memory_capacity_bytes');
  const memUsed = findStat('MEMORY_USAGE_BYTES') ?? findStat('hypervisor_memory_usage_bytes');
  const storageCapacity = findStat('STORAGE_CAPACITY_BYTES') ?? findStat('storage_capacity_bytes');
  const storageUsed = findStat('STORAGE_USAGE_BYTES') ?? findStat('storage_usage_bytes');
  const iops = findStat('IOPS') ?? findStat('controller_num_iops');
  const latencyUsecs =
    findStat('AVG_IO_LATENCY_USECS') ?? findStat('controller_avg_io_latency_usecs');

  const cpuPct =
    cpuCapacityHz && cpuUsedHz && cpuCapacityHz > 0
      ? Math.round((cpuUsedHz / cpuCapacityHz) * 10000) / 100
      : null;
  const memPct =
    memCapacity && memUsed && memCapacity > 0
      ? Math.round((memUsed / memCapacity) * 10000) / 100
      : null;
  const storagePct =
    storageCapacity && storageUsed && storageCapacity > 0
      ? Math.round((storageUsed / storageCapacity) * 10000) / 100
      : null;

  return {
    cpuCapacityHz,
    cpuUsedHz,
    cpuUsagePct: cpuPct,
    memoryCapacityBytes: memCapacity,
    memoryUsedBytes: memUsed,
    memoryUsagePct: memPct,
    storageCapacityBytes: storageCapacity,
    storageUsedBytes: storageUsed,
    storageUsagePct: storagePct,
    iops: iops ?? null,
    avgIoLatencyMs: latencyUsecs != null ? usecsToMs(latencyUsecs) : null,
  };
};

const imagesList: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const name = params?.name as string | undefined;
  const queryParams: Record<string, string> = {};
  if (name) {
    queryParams.$filter = `name eq '${name}'`;
  }

  const { data, totalCount } = await nutanixGet(
    'vmm',
    'content/images',
    config,
    credentials,
    fetchFn,
    queryParams,
  );

  const items = (data as Array<Record<string, unknown>>) ?? [];
  return {
    images: items.map((img) => ({
      name: img.name ?? null,
      extId: img.extId ?? null,
      type: (img.type as string) ?? (img.imageType as string) ?? null,
      sizeBytes: (img.sizeBytes as number) ?? (img.size as number) ?? null,
      sourceClusterId:
        (img.source as Record<string, unknown>)?.clusterExtId ?? img.sourceClusterId ?? null,
      description: img.description ?? null,
      createTime: img.createTime ?? null,
    })),
    totalCount: totalCount ?? items.length,
  };
};

const vmsByHost: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const hostId = params?.host_id as string;
  if (!hostId) throw new Error('host_id parameter is required');

  const { data, totalCount } = await nutanixGet(
    'vmm',
    'ahv/config/vms',
    config,
    credentials,
    fetchFn,
    { $filter: `hostExtId eq '${hostId}'` },
  );

  const items = (data as Array<Record<string, unknown>>) ?? [];
  return {
    vms: items.map((v) => ({
      name: v.name ?? null,
      extId: v.extId ?? null,
      powerState: v.powerState ?? null,
      numSockets: v.numSockets ?? null,
      numCoresPerSocket: v.numCoresPerSocket ?? null,
      memorySizeMb:
        v.memorySizeBytes != null
          ? Math.round((v.memorySizeBytes as number) / 1048576)
          : ((v.memorySizeMb as number) ?? null),
      description: v.description ?? null,
    })),
    totalCount: totalCount ?? items.length,
    hostId,
  };
};

// --- Pack definition ---

export const nutanixPack: IntegrationPack = {
  manifest: {
    name: 'nutanix',
    type: 'integration',
    version: '0.1.0',
    description:
      'Nutanix Prism Central — clusters, VMs, hosts, alerts, storage, categories, networks, and tasks via v4 REST API',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'clusters.list',
        description: 'List Nutanix clusters with health and configuration',
        capability: 'observe',
        params: {
          name: { type: 'string', description: 'Filter by cluster name', required: false },
        },
        timeout: 15000,
      },
      {
        name: 'hosts.list',
        description: 'List hypervisor hosts with hardware and network details',
        capability: 'observe',
        params: {
          cluster_id: {
            type: 'string',
            description: 'Filter by cluster extId',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'vms.list',
        description: 'List AHV virtual machines with filtering',
        capability: 'observe',
        params: {
          name: { type: 'string', description: 'Filter by VM name', required: false },
          power_state: {
            type: 'string',
            description: 'Filter by power state (ON/OFF)',
            required: false,
          },
          cluster_id: {
            type: 'string',
            description: 'Filter by cluster extId',
            required: false,
          },
          limit: { type: 'number', description: 'Max results (default: 50)', required: false },
        },
        timeout: 15000,
      },
      {
        name: 'vm.detail',
        description: 'Full VM configuration with disks, NICs, boot config, and categories',
        capability: 'observe',
        params: {
          vm_id: { type: 'string', description: 'VM extId', required: true },
        },
        timeout: 15000,
      },
      {
        name: 'vm.stats',
        description: 'VM performance stats — CPU, memory, IOPS, latency, network I/O',
        capability: 'observe',
        params: {
          vm_id: { type: 'string', description: 'VM extId', required: true },
        },
        timeout: 30000,
      },
      {
        name: 'alerts.list',
        description: 'List alerts with severity, time range, and entity type filters',
        capability: 'observe',
        params: {
          severity: {
            type: 'string',
            description: 'Filter by severity (CRITICAL/WARNING/INFO)',
            required: false,
          },
          resolved: {
            type: 'boolean',
            description: 'Filter by resolution status',
            required: false,
          },
          hours: {
            type: 'number',
            description: 'Only alerts from the last N hours',
            required: false,
          },
          entity_type: {
            type: 'string',
            description: 'Filter by source entity type',
            required: false,
          },
          limit: { type: 'number', description: 'Max results (default: 50)', required: false },
        },
        timeout: 15000,
      },
      {
        name: 'alerts.summary',
        description: 'Alert summary grouped by severity and entity type',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'storage.containers',
        description: 'Storage containers with capacity, usage, and data services status',
        capability: 'observe',
        params: {
          cluster_id: {
            type: 'string',
            description: 'Filter by cluster extId',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'categories.list',
        description: 'List Prism categories',
        capability: 'observe',
        params: {
          key: { type: 'string', description: 'Filter by category key', required: false },
        },
        timeout: 15000,
      },
      {
        name: 'categories.entities',
        description: 'Find entities tagged with a specific category key:value pair (v3 API)',
        capability: 'observe',
        params: {
          key: { type: 'string', description: 'Category key', required: true },
          value: { type: 'string', description: 'Category value', required: true },
        },
        timeout: 15000,
      },
      {
        name: 'networks.list',
        description: 'List subnets/networks with VLAN, IP config, and cluster assignment',
        capability: 'observe',
        params: {
          cluster_id: {
            type: 'string',
            description: 'Filter by cluster extId',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'tasks.recent',
        description: 'Recent Prism tasks with failure and long-running detection',
        capability: 'observe',
        params: {
          hours: {
            type: 'number',
            description: 'Lookback window in hours (default: 24)',
            required: false,
          },
          status: {
            type: 'string',
            description: 'Filter by status (e.g. FAILED)',
            required: false,
          },
          limit: { type: 'number', description: 'Max results (default: 50)', required: false },
        },
        timeout: 15000,
      },
      {
        name: 'cluster.health',
        description:
          'Composite health check — cluster info, hosts, critical alerts, and storage capacity',
        capability: 'observe',
        params: {
          cluster_id: {
            type: 'string',
            description: 'Cluster extId (uses first cluster if omitted)',
            required: false,
          },
        },
        timeout: 30000,
      },
      {
        name: 'vm.snapshots',
        description: 'VM recovery points / snapshots with age and expiration warnings',
        capability: 'observe',
        params: {
          vm_id: { type: 'string', description: 'VM extId', required: true },
        },
        timeout: 15000,
      },
      {
        name: 'protection.policies',
        description: 'Data protection policies with RPO, retention, and coverage',
        capability: 'observe',
        params: {
          vm_id: {
            type: 'string',
            description: 'VM extId — show only policies covering this VM',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'lifecycle.status',
        description: 'LCM entity versions and available updates (AOS, hypervisor, firmware, NCC)',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'host.stats',
        description: 'Host performance stats with CPU/memory threshold warnings',
        capability: 'observe',
        params: {
          host_id: { type: 'string', description: 'Host extId', required: true },
        },
        timeout: 15000,
      },
      {
        name: 'cluster.stats',
        description: 'Aggregate cluster metrics — CPU, memory, storage utilization, IOPS, latency',
        capability: 'observe',
        params: {
          cluster_id: { type: 'string', description: 'Cluster extId', required: true },
        },
        timeout: 15000,
      },
      {
        name: 'images.list',
        description: 'List disk images and ISOs in the image library',
        capability: 'observe',
        params: {
          name: { type: 'string', description: 'Filter by image name', required: false },
        },
        timeout: 15000,
      },
      {
        name: 'vms.by_host',
        description: 'List all VMs on a specific host — useful for maintenance planning',
        capability: 'observe',
        params: {
          host_id: { type: 'string', description: 'Host extId', required: true },
        },
        timeout: 15000,
      },
    ],
    runbook: {
      category: 'hyperconverged',
      probes: ['clusters.list', 'alerts.summary', 'storage.containers'],
      parallel: true,
    },
  },

  handlers: {
    'clusters.list': clustersList,
    'hosts.list': hostsList,
    'vms.list': vmsList,
    'vm.detail': vmDetail,
    'vm.stats': vmStats,
    'alerts.list': alertsList,
    'alerts.summary': alertsSummary,
    'storage.containers': storageContainers,
    'categories.list': categoriesList,
    'categories.entities': categoriesEntities,
    'networks.list': networksList,
    'tasks.recent': tasksRecent,
    'cluster.health': clusterHealth,
    'vm.snapshots': vmSnapshots,
    'protection.policies': protectionPolicies,
    'lifecycle.status': lifecycleStatus,
    'host.stats': hostStats,
    'cluster.stats': clusterStats,
    'images.list': imagesList,
    'vms.by_host': vmsByHost,
  },

  testConnection: async (config, credentials, fetchFn) => {
    const url = nutanixUrl(config.endpoint, 'clustermgmt', 'config/clusters');
    const fullUrl = new URL(url);
    fullUrl.searchParams.set('$limit', '1');

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...buildAuthHeaders(credentials),
      ...config.headers,
    };

    const res = await fetchFn(fullUrl.toString(), { headers });
    if (!res.ok) return false;
    const body = (await res.json()) as { data?: unknown };
    return body.data != null;
  },
};
