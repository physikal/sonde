import type {
  DiagnosticFinding,
  DiagnosticRunbookDefinition,
  DiagnosticRunbookResult,
  RunProbe,
  RunbookContext,
  RunbookProbeResult,
} from '../types.js';

// --- Helpers ---

function buildResult(
  category: string,
  findings: DiagnosticFinding[],
  probeResults: Record<string, RunbookProbeResult>,
  startTime: number,
  summaryText: string,
): DiagnosticRunbookResult {
  const counts = { info: 0, warning: 0, critical: 0 };
  for (const f of findings) counts[f.severity]++;

  const results = Object.values(probeResults);
  return {
    category,
    findings,
    probeResults,
    summary: {
      probesRun: results.length,
      probesSucceeded: results.filter((r) => r.status === 'success').length,
      probesFailed: results.filter((r) => r.status !== 'success').length,
      findingsCount: counts,
      durationMs: Date.now() - startTime,
      summaryText,
    },
  };
}

function storeResult(
  map: Record<string, RunbookProbeResult>,
  result: RunbookProbeResult,
): RunbookProbeResult {
  map[result.probe] = result;
  return result;
}

function probeData<T>(result: RunbookProbeResult): T | undefined {
  if (result.status !== 'success') return undefined;
  return result.data as T;
}

// --- Nutanix data shapes ---

interface ClusterInfo {
  name?: string | null;
  extId?: string | null;
  operationMode?: string | null;
  isDegraded?: boolean;
  numNodes?: number | null;
}

interface HostInfo {
  name?: string | null;
  extId?: string | null;
  maintenanceMode?: boolean;
}

interface VmInfo {
  name?: string | null;
  extId?: string | null;
  powerState?: string | null;
  numSockets?: number | null;
  numCoresPerSocket?: number | null;
  memorySizeMb?: number | null;
  clusterExtId?: string | null;
  hostExtId?: string | null;
}

interface AlertInfo {
  title?: string | null;
  severity?: string | null;
  sourceEntity?: { type?: string | null; name?: string | null; extId?: string | null };
  creationTime?: string | null;
  possibleCauses?: unknown;
  resolutionSteps?: unknown;
}

interface ContainerInfo {
  name?: string | null;
  usedPct?: number;
  highUsage?: boolean;
  maxCapacityBytes?: number;
  usedBytes?: number;
  availableBytes?: number;
}

interface TaskInfo {
  type?: string | null;
  status?: string | null;
  isFailed?: boolean;
  isLongRunning?: boolean;
  startTime?: string | null;
  errorMessage?: string | null;
}

interface SnapshotInfo {
  name?: string | null;
  ageDays?: number | null;
  isOld?: boolean;
  isExpired?: boolean;
}

// --- 1. Cluster Health Runbook ---

async function clusterHealthHandler(
  _params: Record<string, unknown>,
  runProbe: RunProbe,
  _context: RunbookContext,
): Promise<DiagnosticRunbookResult> {
  const startTime = Date.now();
  const findings: DiagnosticFinding[] = [];
  const probeResults: Record<string, RunbookProbeResult> = {};

  // Group 1: parallel fleet-wide probes
  const [clustersR, alertsR, storageR, tasksR, lifecycleR, hostsR] = await Promise.all([
    runProbe('nutanix.clusters.list').then((r) => storeResult(probeResults, r)),
    runProbe('nutanix.alerts.summary').then((r) => storeResult(probeResults, r)),
    runProbe('nutanix.storage.containers').then((r) => storeResult(probeResults, r)),
    runProbe('nutanix.tasks.recent', { hours: 24 }).then((r) => storeResult(probeResults, r)),
    runProbe('nutanix.lifecycle.status').then((r) => storeResult(probeResults, r)),
    runProbe('nutanix.hosts.list').then((r) => storeResult(probeResults, r)),
  ]);

  // --- Analysis ---

  // Degraded clusters
  const clustersData = probeData<{ clusters?: ClusterInfo[]; totalCount?: number }>(clustersR);
  const clusters = clustersData?.clusters ?? [];
  for (const c of clusters) {
    if (c.isDegraded) {
      findings.push({
        severity: 'critical',
        title: `Cluster ${c.name ?? c.extId} is degraded`,
        detail: `Cluster "${c.name}" is in ${c.operationMode} mode (expected NORMAL)`,
        remediation: 'Check Prism Central for cluster-level alerts and node status',
        relatedProbes: ['nutanix.clusters.list'],
      });
    }
  }

  // Hosts in maintenance
  const hostsData = probeData<{ hosts?: HostInfo[]; totalCount?: number }>(hostsR);
  const hosts = hostsData?.hosts ?? [];
  const maintenanceHosts = hosts.filter((h) => h.maintenanceMode);
  if (maintenanceHosts.length > 0) {
    findings.push({
      severity: 'warning',
      title: `${maintenanceHosts.length} host(s) in maintenance mode`,
      detail: `Hosts in maintenance: ${maintenanceHosts.map((h) => h.name ?? h.extId).join(', ')}`,
      relatedProbes: ['nutanix.hosts.list'],
    });
  }

  // Critical alerts
  const alertsData = probeData<{
    bySeverity?: Record<string, number>;
    unresolvedCritical?: Array<{
      title?: unknown;
      sourceEntity?: unknown;
      creationTime?: unknown;
    }>;
    totalCount?: number;
  }>(alertsR);
  const criticalCount = alertsData?.bySeverity?.CRITICAL ?? 0;
  const unresolvedCritical = alertsData?.unresolvedCritical ?? [];

  if (unresolvedCritical.length > 0) {
    for (const alert of unresolvedCritical.slice(0, 5)) {
      findings.push({
        severity: 'critical',
        title: `Unresolved critical alert: ${alert.title ?? 'Unknown'}`,
        detail: `Source: ${JSON.stringify(alert.sourceEntity)}, Created: ${alert.creationTime ?? 'unknown'}`,
        remediation: 'Review and resolve in Prism Central Alerts dashboard',
        relatedProbes: ['nutanix.alerts.summary'],
      });
    }
    if (unresolvedCritical.length > 5) {
      findings.push({
        severity: 'critical',
        title: `${unresolvedCritical.length - 5} additional unresolved critical alerts`,
        detail: `Total unresolved critical alerts: ${unresolvedCritical.length}`,
        relatedProbes: ['nutanix.alerts.summary'],
      });
    }
  }

  // Storage containers >85%
  const storageData = probeData<{ containers?: ContainerInfo[]; totalCount?: number }>(storageR);
  const containers = storageData?.containers ?? [];
  for (const c of containers) {
    if (c.highUsage) {
      findings.push({
        severity: 'warning',
        title: `Storage container ${c.name} at ${c.usedPct}%`,
        detail: `Container "${c.name}" is running low on capacity`,
        remediation: 'Consider expanding storage or migrating VMs to less utilized containers',
        relatedProbes: ['nutanix.storage.containers'],
      });
    }
  }

  // Failed/long-running tasks
  const tasksData = probeData<{ tasks?: TaskInfo[]; totalCount?: number }>(tasksR);
  const tasks = tasksData?.tasks ?? [];
  const failedTasks = tasks.filter((t) => t.isFailed);
  const longRunning = tasks.filter((t) => t.isLongRunning);

  if (failedTasks.length > 0) {
    findings.push({
      severity: 'warning',
      title: `${failedTasks.length} failed task(s) in last 24 hours`,
      detail: failedTasks
        .slice(0, 5)
        .map((t) => `${t.type}: ${t.errorMessage ?? t.status}`)
        .join('; '),
      relatedProbes: ['nutanix.tasks.recent'],
    });
  }

  if (longRunning.length > 0) {
    findings.push({
      severity: 'warning',
      title: `${longRunning.length} long-running task(s) (>1 hour)`,
      detail: longRunning
        .slice(0, 5)
        .map((t) => `${t.type} started ${t.startTime}`)
        .join('; '),
      relatedProbes: ['nutanix.tasks.recent'],
    });
  }

  // Available LCM updates
  const lifecycleData = probeData<{
    updatableCount?: number;
    warnings?: string[];
  }>(lifecycleR);
  if (lifecycleData?.updatableCount && lifecycleData.updatableCount > 0) {
    findings.push({
      severity: 'info',
      title: `${lifecycleData.updatableCount} component update(s) available`,
      detail: (lifecycleData.warnings ?? []).join('; '),
      relatedProbes: ['nutanix.lifecycle.status'],
    });
  }

  // All clear
  if (findings.length === 0) {
    findings.push({
      severity: 'info',
      title: 'Nutanix environment is healthy',
      detail: `${clusters.length} cluster(s), ${hosts.length} host(s), ${criticalCount} critical alert(s), all storage within thresholds`,
      relatedProbes: [
        'nutanix.clusters.list',
        'nutanix.hosts.list',
        'nutanix.alerts.summary',
        'nutanix.storage.containers',
      ],
    });
  }

  const clusterNames = clusters.map((c) => c.name ?? 'unknown').join(', ');
  const issueCount = findings.filter((f) => f.severity !== 'info').length;
  return buildResult(
    'nutanix-cluster-health',
    findings,
    probeResults,
    startTime,
    `${clusters.length} cluster(s) [${clusterNames}], ${hosts.length} host(s), ${issueCount} issue(s)`,
  );
}

// --- 2. VM Health Runbook ---

async function vmHealthHandler(
  params: Record<string, unknown>,
  runProbe: RunProbe,
  _context: RunbookContext,
): Promise<DiagnosticRunbookResult> {
  const startTime = Date.now();
  const findings: DiagnosticFinding[] = [];
  const probeResults: Record<string, RunbookProbeResult> = {};

  let vmId = params.vm_id as string | undefined;
  const vmName = params.vm_name as string | undefined;

  // Step 1: resolve vm_name → vm_id if needed
  if (!vmId && vmName) {
    const searchR = await runProbe('nutanix.vms.list', { name: vmName });
    storeResult(probeResults, searchR);
    const searchData = probeData<{ vms?: VmInfo[] }>(searchR);
    const found = searchData?.vms?.[0];
    if (!found?.extId) {
      findings.push({
        severity: 'critical',
        title: `VM "${vmName}" not found`,
        detail: searchR.error ?? `No VM matching name "${vmName}" was found`,
        relatedProbes: ['nutanix.vms.list'],
      });
      return buildResult(
        'nutanix-vm-health',
        findings,
        probeResults,
        startTime,
        `VM "${vmName}" not found`,
      );
    }
    vmId = found.extId as string;
  }

  if (!vmId) {
    findings.push({
      severity: 'critical',
      title: 'No VM specified',
      detail: 'Either vm_id or vm_name must be provided',
      relatedProbes: [],
    });
    return buildResult('nutanix-vm-health', findings, probeResults, startTime, 'No VM specified');
  }

  // Step 2: parallel VM probes
  const [detailR, statsR, snapshotsR, alertsR, protectionR] = await Promise.all([
    runProbe('nutanix.vm.detail', { vm_id: vmId }).then((r) => storeResult(probeResults, r)),
    runProbe('nutanix.vm.stats', { vm_id: vmId }).then((r) => storeResult(probeResults, r)),
    runProbe('nutanix.vm.snapshots', { vm_id: vmId }).then((r) => storeResult(probeResults, r)),
    runProbe('nutanix.alerts.list', { entity_type: 'vm', resolved: false, limit: 20 }).then((r) =>
      storeResult(probeResults, r),
    ),
    runProbe('nutanix.protection.policies', { vm_id: vmId }).then((r) =>
      storeResult(probeResults, r),
    ),
  ]);

  // --- Analysis ---

  // VM detail
  const vmData = probeData<{
    name?: string | null;
    extId?: string | null;
    powerState?: string | null;
    numSockets?: number | null;
    numCoresPerSocket?: number | null;
    memorySizeMb?: number | null;
    guestTools?: Record<string, unknown> | null;
    categories?: unknown;
    clusterExtId?: string | null;
    hostExtId?: string | null;
  }>(detailR);

  if (!vmData) {
    findings.push({
      severity: 'critical',
      title: `VM ${vmId} unreachable`,
      detail: detailR.error ?? 'Could not retrieve VM details',
      relatedProbes: ['nutanix.vm.detail'],
    });
    return buildResult(
      'nutanix-vm-health',
      findings,
      probeResults,
      startTime,
      `VM ${vmId} unreachable`,
    );
  }

  const vmLabel = vmData.name ?? vmId;

  // Power state
  if (vmData.powerState === 'OFF') {
    findings.push({
      severity: 'warning',
      title: `VM ${vmLabel} is powered off`,
      detail: `VM "${vmLabel}" is not running`,
      relatedProbes: ['nutanix.vm.detail'],
    });
  }

  // Performance stats
  const statsData = probeData<{
    cpuUsagePct?: number | null;
    memoryUsagePct?: number | null;
    iops?: number | null;
    avgIoLatencyMs?: number | null;
  }>(statsR);

  if (statsData) {
    if (statsData.cpuUsagePct != null && statsData.cpuUsagePct > 85) {
      findings.push({
        severity: 'warning',
        title: `VM ${vmLabel} CPU at ${statsData.cpuUsagePct}%`,
        detail: 'CPU utilization is high. Consider adding vCPUs or investigating workload.',
        relatedProbes: ['nutanix.vm.stats'],
      });
    }

    if (statsData.memoryUsagePct != null && statsData.memoryUsagePct > 90) {
      findings.push({
        severity: 'warning',
        title: `VM ${vmLabel} memory at ${statsData.memoryUsagePct}%`,
        detail: 'Memory utilization is critically high. Consider adding memory.',
        relatedProbes: ['nutanix.vm.stats'],
      });
    }

    if (statsData.avgIoLatencyMs != null && statsData.avgIoLatencyMs > 20) {
      findings.push({
        severity: 'warning',
        title: `VM ${vmLabel} I/O latency at ${statsData.avgIoLatencyMs}ms`,
        detail: 'Average I/O latency exceeds 20ms threshold. Check storage performance.',
        relatedProbes: ['nutanix.vm.stats'],
      });
    }
  }

  // Protection policies
  const protectionData = probeData<{
    vmCovered?: boolean;
    policies?: Array<{ name?: string | null }>;
    totalCount?: number;
  }>(protectionR);

  if (protectionData && protectionData.vmCovered === false) {
    findings.push({
      severity: 'warning',
      title: `VM ${vmLabel} has no data protection`,
      detail: 'No protection policies cover this VM. It is not being backed up.',
      remediation: 'Add this VM to a protection policy in Prism Central Data Protection',
      relatedProbes: ['nutanix.protection.policies'],
    });
  }

  // Snapshots
  const snapshotsData = probeData<{
    snapshots?: SnapshotInfo[];
    totalCount?: number;
    warnings?: string[];
  }>(snapshotsR);

  if (snapshotsData) {
    const oldSnapshots = (snapshotsData.snapshots ?? []).filter((s) => s.isOld);
    const expiredSnapshots = (snapshotsData.snapshots ?? []).filter((s) => s.isExpired);

    if (oldSnapshots.length > 0) {
      findings.push({
        severity: 'info',
        title: `${oldSnapshots.length} snapshot(s) older than 7 days`,
        detail: oldSnapshots.map((s) => `${s.name ?? 'unnamed'}: ${s.ageDays} days old`).join('; '),
        remediation: 'Review and clean up old snapshots to reclaim storage',
        relatedProbes: ['nutanix.vm.snapshots'],
      });
    }

    if (expiredSnapshots.length > 0) {
      findings.push({
        severity: 'warning',
        title: `${expiredSnapshots.length} expired snapshot(s) not cleaned up`,
        detail: 'Expired recovery points should be removed to reclaim storage',
        remediation: 'Delete expired snapshots via Prism Central',
        relatedProbes: ['nutanix.vm.snapshots'],
      });
    }
  }

  // Guest tools
  if (vmData.guestTools) {
    const gtEnabled =
      (vmData.guestTools as Record<string, unknown>).isEnabled ??
      (vmData.guestTools as Record<string, unknown>).ngtState;
    if (!gtEnabled || gtEnabled === 'UNINSTALLED') {
      findings.push({
        severity: 'info',
        title: `Guest tools not installed on ${vmLabel}`,
        detail: 'Nutanix Guest Tools (NGT) are not installed. Some features may be unavailable.',
        remediation: 'Install NGT from Prism Central VM management',
        relatedProbes: ['nutanix.vm.detail'],
      });
    }
  }

  // VM-related alerts
  const alertsData = probeData<{ alerts?: AlertInfo[]; totalCount?: number }>(alertsR);
  const vmAlerts = (alertsData?.alerts ?? []).filter(
    (a) => a.sourceEntity?.extId === vmId || a.sourceEntity?.name === vmData.name,
  );
  if (vmAlerts.length > 0) {
    for (const alert of vmAlerts.slice(0, 3)) {
      findings.push({
        severity: alert.severity === 'CRITICAL' ? 'critical' : 'warning',
        title: `Alert: ${alert.title ?? 'Unknown'}`,
        detail: `Source: ${alert.sourceEntity?.name ?? 'unknown'}, Created: ${alert.creationTime ?? 'unknown'}`,
        relatedProbes: ['nutanix.alerts.list'],
      });
    }
  }

  // All clear
  if (findings.length === 0) {
    findings.push({
      severity: 'info',
      title: `VM ${vmLabel} is healthy`,
      detail: 'VM is running, performance within thresholds, data protection in place',
      relatedProbes: ['nutanix.vm.detail', 'nutanix.vm.stats', 'nutanix.protection.policies'],
    });
  }

  return buildResult(
    'nutanix-vm-health',
    findings,
    probeResults,
    startTime,
    `VM ${vmLabel} health check: ${findings.length} finding(s)`,
  );
}

// --- 3. Capacity Planning Runbook ---

async function capacityPlanningHandler(
  _params: Record<string, unknown>,
  runProbe: RunProbe,
  _context: RunbookContext,
): Promise<DiagnosticRunbookResult> {
  const startTime = Date.now();
  const findings: DiagnosticFinding[] = [];
  const probeResults: Record<string, RunbookProbeResult> = {};

  // Step 1: get all clusters
  const clustersR = await runProbe('nutanix.clusters.list');
  storeResult(probeResults, clustersR);

  const clustersData = probeData<{ clusters?: ClusterInfo[] }>(clustersR);
  const clusters = clustersData?.clusters ?? [];

  if (clusters.length === 0) {
    findings.push({
      severity: 'critical',
      title: 'No clusters found',
      detail: clustersR.error ?? 'Could not retrieve cluster information',
      relatedProbes: ['nutanix.clusters.list'],
    });
    return buildResult(
      'nutanix-capacity-planning',
      findings,
      probeResults,
      startTime,
      'No clusters found',
    );
  }

  // Step 2: per-cluster stats, storage, hosts, VMs (parallel per cluster)
  for (const cluster of clusters) {
    const clusterId = cluster.extId as string;
    if (!clusterId) continue;

    const clusterLabel = (cluster.name as string) ?? clusterId;

    const [statsR, storageR, hostsR, vmsR] = await Promise.all([
      runProbe('nutanix.cluster.stats', { cluster_id: clusterId }).then((r) =>
        storeResult(probeResults, { ...r, probe: `nutanix.cluster.stats:${clusterLabel}` }),
      ),
      runProbe('nutanix.storage.containers', { cluster_id: clusterId }).then((r) =>
        storeResult(probeResults, { ...r, probe: `nutanix.storage.containers:${clusterLabel}` }),
      ),
      runProbe('nutanix.hosts.list', { cluster_id: clusterId }).then((r) =>
        storeResult(probeResults, { ...r, probe: `nutanix.hosts.list:${clusterLabel}` }),
      ),
      runProbe('nutanix.vms.list', { cluster_id: clusterId, power_state: 'ON', limit: 500 }).then(
        (r) => storeResult(probeResults, { ...r, probe: `nutanix.vms.list:${clusterLabel}` }),
      ),
    ]);

    // Cluster resource utilization
    const stats = probeData<{
      cpuUsagePct?: number | null;
      memoryUsagePct?: number | null;
      storageUsagePct?: number | null;
      cpuCapacityHz?: number | null;
      cpuUsedHz?: number | null;
      memoryCapacityBytes?: number | null;
      memoryUsedBytes?: number | null;
      storageCapacityBytes?: number | null;
      storageUsedBytes?: number | null;
    }>(statsR);

    if (stats) {
      // CPU headroom
      if (stats.cpuUsagePct != null && stats.cpuUsagePct > 80) {
        findings.push({
          severity: stats.cpuUsagePct > 90 ? 'critical' : 'warning',
          title: `Cluster ${clusterLabel} CPU at ${stats.cpuUsagePct}%`,
          detail: `CPU capacity is ${stats.cpuUsagePct > 90 ? 'critically' : 'significantly'} consumed`,
          remediation: 'Add nodes or migrate workloads to less utilized clusters',
          relatedProbes: [`nutanix.cluster.stats:${clusterLabel}`],
        });
      }

      // Memory headroom
      if (stats.memoryUsagePct != null && stats.memoryUsagePct > 80) {
        findings.push({
          severity: stats.memoryUsagePct > 90 ? 'critical' : 'warning',
          title: `Cluster ${clusterLabel} memory at ${stats.memoryUsagePct}%`,
          detail: `Memory capacity is ${stats.memoryUsagePct > 90 ? 'critically' : 'significantly'} consumed`,
          remediation: 'Add memory or migrate VMs to other clusters',
          relatedProbes: [`nutanix.cluster.stats:${clusterLabel}`],
        });
      }

      // Storage headroom
      if (stats.storageUsagePct != null && stats.storageUsagePct > 80) {
        findings.push({
          severity: stats.storageUsagePct > 90 ? 'critical' : 'warning',
          title: `Cluster ${clusterLabel} storage at ${stats.storageUsagePct}%`,
          detail: `Storage capacity is ${stats.storageUsagePct > 90 ? 'critically' : 'significantly'} consumed`,
          remediation: 'Add storage nodes, enable deduplication/compression, or archive cold data',
          relatedProbes: [`nutanix.cluster.stats:${clusterLabel}`],
        });
      }
    }

    // Per-container storage analysis
    const containerData = probeData<{ containers?: ContainerInfo[] }>(storageR);
    for (const c of containerData?.containers ?? []) {
      if (c.highUsage) {
        findings.push({
          severity: 'warning',
          title: `Container ${c.name} on ${clusterLabel} at ${c.usedPct}%`,
          detail: 'Storage container is above 85% utilization',
          relatedProbes: [`nutanix.storage.containers:${clusterLabel}`],
        });
      }
    }

    // Host count vs VM density
    const hostsData = probeData<{ hosts?: HostInfo[] }>(hostsR);
    const vmsData = probeData<{ vms?: VmInfo[]; totalCount?: number }>(vmsR);
    const hostCount = hostsData?.hosts?.length ?? 0;
    const vmCount = vmsData?.totalCount ?? vmsData?.vms?.length ?? 0;

    if (hostCount > 0 && vmCount > 0) {
      const vmPerHost = Math.round((vmCount / hostCount) * 10) / 10;
      if (vmPerHost > 30) {
        findings.push({
          severity: 'warning',
          title: `High VM density on ${clusterLabel}: ${vmPerHost} VMs/host`,
          detail: `${vmCount} running VMs across ${hostCount} hosts. High density may impact performance.`,
          relatedProbes: [`nutanix.hosts.list:${clusterLabel}`, `nutanix.vms.list:${clusterLabel}`],
        });
      }
    }
  }

  // All clear
  if (findings.length === 0) {
    findings.push({
      severity: 'info',
      title: 'Capacity is within healthy thresholds',
      detail: `${clusters.length} cluster(s) analyzed, all below 80% on CPU, memory, and storage`,
      relatedProbes: ['nutanix.clusters.list'],
    });
  }

  const issueCount = findings.filter((f) => f.severity !== 'info').length;
  return buildResult(
    'nutanix-capacity-planning',
    findings,
    probeResults,
    startTime,
    `${clusters.length} cluster(s) analyzed, ${issueCount} capacity concern(s)`,
  );
}

// --- 4. Storefront Investigation Runbook ---

async function storefrontInvestigateHandler(
  params: Record<string, unknown>,
  runProbe: RunProbe,
  _context: RunbookContext,
): Promise<DiagnosticRunbookResult> {
  const startTime = Date.now();
  const findings: DiagnosticFinding[] = [];
  const probeResults: Record<string, RunbookProbeResult> = {};

  const categoryKey = params.category_key as string;
  const categoryValue = params.category_value as string;

  if (!categoryKey || !categoryValue) {
    findings.push({
      severity: 'critical',
      title: 'Missing category parameters',
      detail: 'Both category_key and category_value must be provided',
      relatedProbes: [],
    });
    return buildResult(
      'nutanix-storefront-investigate',
      findings,
      probeResults,
      startTime,
      'Missing category parameters',
    );
  }

  // Step 1: find entities tagged with this category
  const entitiesR = await runProbe('nutanix.categories.entities', {
    key: categoryKey,
    value: categoryValue,
  });
  storeResult(probeResults, entitiesR);

  const entitiesData = probeData<{
    entities?: Array<{ entityType: string; entityId: string; entityName?: string | null }>;
    totalCount?: number;
  }>(entitiesR);

  const entities = entitiesData?.entities ?? [];
  const vmEntities = entities.filter((e) => e.entityType === 'vm');

  if (entities.length === 0) {
    findings.push({
      severity: 'info',
      title: `No entities tagged ${categoryKey}:${categoryValue}`,
      detail: 'No VMs or other entities found with this category assignment',
      relatedProbes: ['nutanix.categories.entities'],
    });
    return buildResult(
      'nutanix-storefront-investigate',
      findings,
      probeResults,
      startTime,
      `No entities tagged ${categoryKey}:${categoryValue}`,
    );
  }

  if (vmEntities.length === 0) {
    findings.push({
      severity: 'info',
      title: `${entities.length} entity(ies) found but no VMs`,
      detail: `Entities tagged ${categoryKey}:${categoryValue}: ${entities.map((e) => `${e.entityType}:${e.entityName ?? e.entityId}`).join(', ')}`,
      relatedProbes: ['nutanix.categories.entities'],
    });
    return buildResult(
      'nutanix-storefront-investigate',
      findings,
      probeResults,
      startTime,
      `${entities.length} entity(ies) found, 0 VMs`,
    );
  }

  // Step 2: parallel detail + stats for each VM (limit to 10 for performance)
  const vmsToCheck = vmEntities.slice(0, 10);
  const vmResults = await Promise.all(
    vmsToCheck.map(async (vm) => {
      const [detailR, statsR] = await Promise.all([
        runProbe('nutanix.vm.detail', { vm_id: vm.entityId }).then((r) =>
          storeResult(probeResults, {
            ...r,
            probe: `nutanix.vm.detail:${vm.entityName ?? vm.entityId}`,
          }),
        ),
        runProbe('nutanix.vm.stats', { vm_id: vm.entityId }).then((r) =>
          storeResult(probeResults, {
            ...r,
            probe: `nutanix.vm.stats:${vm.entityName ?? vm.entityId}`,
          }),
        ),
      ]);
      return { vm, detailR, statsR };
    }),
  );

  // Step 3: get alerts for the environment
  const alertsR = await runProbe('nutanix.alerts.list', {
    resolved: false,
    severity: 'CRITICAL',
    limit: 50,
  });
  storeResult(probeResults, alertsR);

  // --- Analysis per VM ---

  let poweredOffCount = 0;
  let highCpuCount = 0;
  let highMemCount = 0;

  for (const { vm, detailR, statsR } of vmResults) {
    const vmLabel = vm.entityName ?? vm.entityId;
    const detail = probeData<{
      name?: string | null;
      powerState?: string | null;
      guestTools?: Record<string, unknown> | null;
    }>(detailR);
    const stats = probeData<{
      cpuUsagePct?: number | null;
      memoryUsagePct?: number | null;
      avgIoLatencyMs?: number | null;
    }>(statsR);

    if (detail?.powerState === 'OFF') {
      poweredOffCount++;
      findings.push({
        severity: 'warning',
        title: `${vmLabel} is powered off`,
        detail: `VM tagged ${categoryKey}:${categoryValue} is not running`,
        relatedProbes: [`nutanix.vm.detail:${vmLabel}`],
      });
      continue;
    }

    if (stats) {
      if (stats.cpuUsagePct != null && stats.cpuUsagePct > 85) {
        highCpuCount++;
        findings.push({
          severity: 'warning',
          title: `${vmLabel} CPU at ${stats.cpuUsagePct}%`,
          detail: `High CPU on ${categoryKey}:${categoryValue} tagged VM`,
          relatedProbes: [`nutanix.vm.stats:${vmLabel}`],
        });
      }

      if (stats.memoryUsagePct != null && stats.memoryUsagePct > 90) {
        highMemCount++;
        findings.push({
          severity: 'warning',
          title: `${vmLabel} memory at ${stats.memoryUsagePct}%`,
          detail: `High memory on ${categoryKey}:${categoryValue} tagged VM`,
          relatedProbes: [`nutanix.vm.stats:${vmLabel}`],
        });
      }

      if (stats.avgIoLatencyMs != null && stats.avgIoLatencyMs > 20) {
        findings.push({
          severity: 'warning',
          title: `${vmLabel} I/O latency at ${stats.avgIoLatencyMs}ms`,
          detail: `High I/O latency on ${categoryKey}:${categoryValue} tagged VM`,
          relatedProbes: [`nutanix.vm.stats:${vmLabel}`],
        });
      }
    }
  }

  // Cross-reference alerts with tagged VMs
  const alertsDataInv = probeData<{ alerts?: AlertInfo[] }>(alertsR);
  const vmIds = new Set(vmsToCheck.map((v) => v.entityId));
  const vmNames = new Set(vmsToCheck.map((v) => v.entityName).filter(Boolean));

  const relatedAlerts = (alertsDataInv?.alerts ?? []).filter(
    (a) =>
      (a.sourceEntity?.extId && vmIds.has(a.sourceEntity.extId)) ||
      (a.sourceEntity?.name && vmNames.has(a.sourceEntity.name)),
  );

  for (const alert of relatedAlerts.slice(0, 5)) {
    findings.push({
      severity: 'critical',
      title: `Critical alert on ${alert.sourceEntity?.name ?? 'tagged VM'}: ${alert.title}`,
      detail: `Alert on ${categoryKey}:${categoryValue} tagged entity`,
      relatedProbes: ['nutanix.alerts.list'],
    });
  }

  // Summary-level findings
  if (poweredOffCount > 0 && poweredOffCount === vmsToCheck.length) {
    findings.push({
      severity: 'critical',
      title: `All ${categoryKey}:${categoryValue} VMs are powered off`,
      detail: `All ${poweredOffCount} VMs tagged with this category are not running`,
      relatedProbes: ['nutanix.categories.entities'],
    });
  }

  // All clear
  if (findings.length === 0) {
    findings.push({
      severity: 'info',
      title: `All ${categoryKey}:${categoryValue} VMs are healthy`,
      detail: `${vmsToCheck.length} VM(s) checked, all running with performance within thresholds`,
      relatedProbes: ['nutanix.categories.entities'],
    });
  }

  const issueCount = findings.filter((f) => f.severity !== 'info').length;
  return buildResult(
    'nutanix-storefront-investigate',
    findings,
    probeResults,
    startTime,
    `${vmsToCheck.length} VM(s) tagged ${categoryKey}:${categoryValue}, ${issueCount} issue(s)`,
  );
}

// --- Export ---

export const nutanixDiagnosticRunbooks: DiagnosticRunbookDefinition[] = [
  {
    category: 'nutanix-cluster-health',
    description:
      'Fleet-wide Nutanix environment health overview — clusters, hosts, alerts, storage, tasks, LCM updates',
    handler: clusterHealthHandler,
  },
  {
    category: 'nutanix-vm-health',
    description:
      'Deep health check for a single Nutanix VM — performance, protection, snapshots, alerts',
    params: {
      vm_id: { type: 'string', description: 'VM extId', required: false },
      vm_name: { type: 'string', description: 'VM name (resolved to extId)', required: false },
    },
    handler: vmHealthHandler,
  },
  {
    category: 'nutanix-capacity-planning',
    description:
      'Capacity and headroom analysis across all Nutanix clusters — CPU, memory, storage utilization',
    handler: capacityPlanningHandler,
  },
  {
    category: 'nutanix-storefront-investigate',
    description:
      'Investigate VMs tagged with a Nutanix category — cross-reference performance, alerts, and health',
    params: {
      category_key: {
        type: 'string',
        description: 'Nutanix category key (e.g. Environment)',
        required: true,
      },
      category_value: {
        type: 'string',
        description: 'Nutanix category value (e.g. Storefront)',
        required: true,
      },
    },
    handler: storefrontInvestigateHandler,
  },
];
