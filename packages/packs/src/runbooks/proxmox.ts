import type {
  DiagnosticFinding,
  DiagnosticRunbookDefinition,
  DiagnosticRunbookResult,
  RunProbe,
  RunbookContext,
  RunbookProbeResult,
} from '../types.js';

// --- Helper ---

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

// --- VM Health Runbook ---

async function vmHealthHandler(
  params: Record<string, unknown>,
  runProbe: RunProbe,
  context: RunbookContext,
): Promise<DiagnosticRunbookResult> {
  const startTime = Date.now();
  const vmid = params.vmid as number;
  const findings: DiagnosticFinding[] = [];
  const probeResults: Record<string, RunbookProbeResult> = {};

  // Group 1: parallel integration probes
  const [clusterStatusR, haStatusR, vmStatusR, tasksR] = await Promise.all([
    runProbe('proxmox.cluster.status').then((r) => storeResult(probeResults, r)),
    runProbe('proxmox.cluster.ha.status').then((r) => storeResult(probeResults, r)),
    runProbe('proxmox.vm.status', { vmid }).then((r) => storeResult(probeResults, r)),
    runProbe('proxmox.cluster.tasks', { vmid }).then((r) => storeResult(probeResults, r)),
  ]);

  // Extract node and type from vm.status
  const vmData = probeData<{
    node?: string;
    type?: string;
    status?: string;
    lock?: string;
    hastate?: string;
    name?: string;
  }>(vmStatusR);

  if (!vmData?.node) {
    findings.push({
      severity: 'critical',
      title: `VM ${vmid} not found or unreachable`,
      detail: vmStatusR.error ?? 'Could not retrieve VM status',
      relatedProbes: ['proxmox.vm.status'],
    });
    return buildResult('proxmox-vm', findings, probeResults, startTime, `VM ${vmid} not found`);
  }

  const node = vmData.node;
  const vmType = vmData.type as 'qemu' | 'lxc';

  // Group 2: conditional config + storage
  const configProbe =
    vmType === 'qemu'
      ? runProbe('proxmox.vm.config', { vmid, node }).then((r) => storeResult(probeResults, r))
      : runProbe('proxmox.lxc.config', { vmid, node }).then((r) => storeResult(probeResults, r));
  const storageProbe = runProbe('proxmox.node.storage', { node }).then((r) =>
    storeResult(probeResults, r),
  );
  const [configR, storageR] = await Promise.all([configProbe, storageProbe] as const);

  // Group 3: optional agent probe
  if (context.connectedAgents.includes(node)) {
    const lvmR = await runProbe('proxmox-node.local.lvm', undefined, node);
    storeResult(probeResults, lvmR);
  }

  // --- Analysis ---

  // Cluster health
  const clusterData = probeData<{
    quorate?: boolean;
    nodes?: Array<{ name?: string; online?: boolean }>;
  }>(clusterStatusR);
  if (clusterData) {
    if (!clusterData.quorate) {
      findings.push({
        severity: 'critical',
        title: 'Cluster unhealthy — quorum lost',
        detail: 'The cluster has lost quorum. Nodes may be unreachable.',
        relatedProbes: ['proxmox.cluster.status'],
      });
    }
    const offlineNodes = (clusterData.nodes ?? []).filter((n) => !n.online);
    if (offlineNodes.length > 0) {
      findings.push({
        severity: 'critical',
        title: 'Cluster unhealthy — nodes offline',
        detail: `Offline nodes: ${offlineNodes.map((n) => n.name).join(', ')}`,
        relatedProbes: ['proxmox.cluster.status'],
      });
    }
  }

  // HA status for this VM
  const haData = probeData<{
    resources?: Array<{ sid?: string; state?: string }>;
  }>(haStatusR);
  const haResources = haData?.resources ?? [];
  const vmSid = `vm:${vmid}`;
  const vmHaResource = haResources.find((r) => r.sid === vmSid);
  const isHaManaged = !!vmHaResource;

  if (vmHaResource && (vmHaResource.state === 'error' || vmHaResource.state === 'fence')) {
    const unlockCmd = vmType === 'qemu' ? `qm unlock ${vmid}` : `pct unlock ${vmid}`;
    findings.push({
      severity: 'critical',
      title: `HA error for vm:${vmid}`,
      detail: `HA resource vm:${vmid} is in "${vmHaResource.state}" state`,
      remediation: `ha-manager set vm:${vmid} --state disabled && ${unlockCmd}`,
      relatedProbes: ['proxmox.cluster.ha.status'],
    });
  }

  // VM lock
  if (vmData.lock) {
    const unlockCmd = vmType === 'qemu' ? `qm unlock ${vmid}` : `pct unlock ${vmid}`;
    findings.push({
      severity: 'warning',
      title: `VM ${vmid} has stale lock: ${vmData.lock}`,
      detail: `VM is locked with reason "${vmData.lock}". This may prevent operations.`,
      remediation: unlockCmd,
      relatedProbes: ['proxmox.vm.status'],
    });
  }

  // VM stopped
  if (vmData.status === 'stopped') {
    findings.push({
      severity: 'warning',
      title: `VM ${vmid} is stopped`,
      detail: `VM ${vmid} (${vmData.name ?? 'unknown'}) is not running`,
      relatedProbes: ['proxmox.vm.status'],
    });
  }

  // Storage accessibility
  const storageData = probeData<{
    storages?: Array<{ storage?: string; active?: boolean; enabled?: boolean; shared?: boolean }>;
  }>(storageR);
  const storages = storageData?.storages ?? [];

  // Check config disks against storage
  if (configR) {
    const configData = probeData<{
      disks?: Array<{ key: string; storage: string }>;
      rootfs?: { storage: string };
      mountpoints?: Array<{ key: string; storage: string }>;
    }>(configR);

    // Collect disk storage names from config
    const diskStorages: Array<{ key: string; storage: string }> = [];
    if (vmType === 'qemu' && configData?.disks) {
      for (const d of configData.disks) diskStorages.push(d);
    } else if (vmType === 'lxc') {
      if (configData?.rootfs)
        diskStorages.push({ key: 'rootfs', storage: configData.rootfs.storage });
      if (configData?.mountpoints) {
        for (const mp of configData.mountpoints) diskStorages.push(mp);
      }
    }

    for (const disk of diskStorages) {
      const stor = storages.find((s) => s.storage === disk.storage);

      // Storage inactive
      if (stor && !stor.active) {
        findings.push({
          severity: 'critical',
          title: `Storage ${disk.storage} not accessible on ${node}`,
          detail: `Storage "${disk.storage}" used by disk ${disk.key} is inactive on node ${node}`,
          remediation: 'Check LVM/NFS mounts on the node',
          relatedProbes: [
            'proxmox.node.storage',
            vmType === 'qemu' ? 'proxmox.vm.config' : 'proxmox.lxc.config',
          ],
        });
      }

      // Local storage + HA managed
      if (isHaManaged && stor && !stor.shared) {
        const sharedStor = storages.find((s) => s.shared && s.active);
        const moveCmd =
          vmType === 'qemu'
            ? `qm move-disk ${vmid} ${disk.key} ${sharedStor?.storage ?? '<shared-storage>'} --delete`
            : `pct move-volume ${vmid} ${disk.key} ${sharedStor?.storage ?? '<shared-storage>'}`;
        findings.push({
          severity: 'critical',
          title: `VM ${vmid} uses local storage but is HA-managed`,
          detail: `Disk ${disk.key} is on local storage "${disk.storage}" but VM is HA-managed. HA failover will fail.`,
          remediation: moveCmd,
          relatedProbes: [
            'proxmox.cluster.ha.status',
            vmType === 'qemu' ? 'proxmox.vm.config' : 'proxmox.lxc.config',
            'proxmox.node.storage',
          ],
        });
      }
    }
  }

  // Failed recent tasks
  const tasksData = probeData<{
    tasks?: Array<{ type?: string; status?: string; node?: string; starttime?: number }>;
  }>(tasksR);
  const failedTasks = (tasksData?.tasks ?? []).filter(
    (t) => t.status && t.status !== 'OK' && t.status !== '',
  );
  if (failedTasks.length > 0) {
    findings.push({
      severity: 'warning',
      title: `Recent task failures for VM ${vmid}`,
      detail: failedTasks.map((t) => `${t.type} on ${t.node}: ${t.status}`).join('; '),
      relatedProbes: ['proxmox.cluster.tasks'],
    });
  }

  // All clear
  if (findings.length === 0) {
    findings.push({
      severity: 'info',
      title: `VM ${vmid} is healthy`,
      detail: `VM ${vmid} (${vmData.name ?? 'unknown'}) is running on ${node}, all storage accessible.`,
      relatedProbes: ['proxmox.vm.status', 'proxmox.node.storage'],
    });
  }

  return buildResult(
    'proxmox-vm',
    findings,
    probeResults,
    startTime,
    `VM ${vmid} health check: ${findings.length} finding(s)`,
  );
}

// --- Cluster Health Runbook ---

async function clusterHealthHandler(
  params: Record<string, unknown>,
  runProbe: RunProbe,
  _context: RunbookContext,
): Promise<DiagnosticRunbookResult> {
  const startTime = Date.now();
  const limit = (params.limit as number) ?? 20;
  const findings: DiagnosticFinding[] = [];
  const probeResults: Record<string, RunbookProbeResult> = {};

  // Group 1: parallel
  const [clusterStatusR, nodesListR, haStatusR, tasksR] = await Promise.all([
    runProbe('proxmox.cluster.status').then((r) => storeResult(probeResults, r)),
    runProbe('proxmox.nodes.list').then((r) => storeResult(probeResults, r)),
    runProbe('proxmox.cluster.ha.status').then((r) => storeResult(probeResults, r)),
    runProbe('proxmox.cluster.tasks', { limit }).then((r) => storeResult(probeResults, r)),
  ]);

  // Extract nodes
  const nodesData = probeData<{
    nodes?: Array<{
      node?: string;
      status?: string;
      cpu?: number;
      mem?: number;
      maxmem?: number;
    }>;
  }>(nodesListR);
  const nodes = nodesData?.nodes ?? [];

  // Group 2: storage per node (parallel)
  const storageResults = await Promise.all(
    nodes.map(async (n) => {
      if (!n.node) return null;
      const r = await runProbe('proxmox.node.storage', { node: n.node });
      storeResult(probeResults, { ...r, probe: `proxmox.node.storage:${n.node}` });
      return { node: n.node, result: r };
    }),
  );

  // --- Analysis ---

  // Node offline
  for (const n of nodes) {
    if (n.status === 'offline') {
      findings.push({
        severity: 'critical',
        title: `Node ${n.node} is offline`,
        detail: `Node ${n.node} is not responding`,
        relatedProbes: ['proxmox.nodes.list'],
      });
    }
  }

  // High CPU
  for (const n of nodes) {
    if (n.cpu != null && n.cpu > 0.9) {
      findings.push({
        severity: 'warning',
        title: `Node ${n.node} CPU at ${Math.round(n.cpu * 100)}%`,
        detail: `Node ${n.node} CPU utilization is critically high`,
        relatedProbes: ['proxmox.nodes.list'],
      });
    }
  }

  // High memory
  for (const n of nodes) {
    if (n.mem != null && n.maxmem != null && n.maxmem > 0 && n.mem / n.maxmem > 0.9) {
      findings.push({
        severity: 'warning',
        title: `Node ${n.node} memory at ${Math.round((n.mem / n.maxmem) * 100)}%`,
        detail: `Node ${n.node} memory utilization is critically high`,
        relatedProbes: ['proxmox.nodes.list'],
      });
    }
  }

  // HA resources in error/fence
  const haData = probeData<{
    resources?: Array<{ sid?: string; state?: string; node?: string }>;
  }>(haStatusR);
  for (const r of haData?.resources ?? []) {
    if (r.state === 'error' || r.state === 'fence') {
      findings.push({
        severity: 'critical',
        title: `HA resource ${r.sid} in ${r.state} state`,
        detail: `HA resource ${r.sid} on node ${r.node ?? 'unknown'} is in "${r.state}" state`,
        remediation: `ha-manager set ${r.sid} --state disabled`,
        relatedProbes: ['proxmox.cluster.ha.status'],
      });
    }
  }

  // Storage > 85% or inactive
  for (const sr of storageResults) {
    if (!sr) continue;
    const storData = probeData<{
      storages?: Array<{
        storage?: string;
        total?: number;
        used?: number;
        active?: boolean;
        enabled?: boolean;
      }>;
    }>(sr.result);
    for (const s of storData?.storages ?? []) {
      if (s.total && s.used && s.total > 0 && s.used / s.total > 0.85) {
        findings.push({
          severity: 'warning',
          title: `Storage ${s.storage} on ${sr.node} at ${Math.round((s.used / s.total) * 100)}%`,
          detail: `Storage pool "${s.storage}" on node ${sr.node} is running low on space`,
          relatedProbes: [`proxmox.node.storage:${sr.node}`],
        });
      }
      if (!s.active && s.enabled !== false) {
        findings.push({
          severity: 'warning',
          title: `Storage ${s.storage} inactive on ${sr.node}`,
          detail: `Storage "${s.storage}" on node ${sr.node} is enabled but not active`,
          relatedProbes: [`proxmox.node.storage:${sr.node}`],
        });
      }
    }
  }

  // Failed tasks in last 24h
  const tasksData = probeData<{
    tasks?: Array<{
      type?: string;
      status?: string;
      node?: string;
      starttime?: number;
      endtime?: number;
    }>;
  }>(tasksR);
  const now = Date.now() / 1000;
  const oneDayAgo = now - 24 * 60 * 60;
  const recentFailedTasks = (tasksData?.tasks ?? []).filter(
    (t) =>
      t.status &&
      t.status !== 'OK' &&
      t.status !== '' &&
      t.endtime != null &&
      t.starttime != null &&
      t.starttime > oneDayAgo,
  );
  for (const t of recentFailedTasks) {
    findings.push({
      severity: 'warning',
      title: `Failed task: ${t.type} on ${t.node}`,
      detail: `Task ${t.type} on ${t.node} failed: ${t.status}`,
      relatedProbes: ['proxmox.cluster.tasks'],
    });
  }

  const onlineNodes = nodes.filter((n) => n.status !== 'offline').length;
  const issueCount = findings.length;
  const summaryText = `${onlineNodes} nodes online, ${issueCount} issues found`;

  return buildResult('proxmox-cluster', findings, probeResults, startTime, summaryText);
}

// --- Storage Audit Runbook ---

async function storageAuditHandler(
  _params: Record<string, unknown>,
  runProbe: RunProbe,
  _context: RunbookContext,
): Promise<DiagnosticRunbookResult> {
  const startTime = Date.now();
  const findings: DiagnosticFinding[] = [];
  const probeResults: Record<string, RunbookProbeResult> = {};

  // Group 1: get all resources + HA status
  const [resourcesR, haStatusR] = await Promise.all([
    runProbe('proxmox.cluster.resources').then((r) => storeResult(probeResults, r)),
    runProbe('proxmox.cluster.ha.status').then((r) => storeResult(probeResults, r)),
  ]);

  const resourcesData = probeData<{
    resources?: Array<{
      vmid?: number;
      name?: string;
      node?: string;
      type?: string;
      status?: string;
    }>;
  }>(resourcesR);
  const haData = probeData<{
    resources?: Array<{ sid?: string; state?: string }>;
  }>(haStatusR);

  const allVMs = resourcesData?.resources ?? [];
  const haResources = haData?.resources ?? [];

  // Extract HA-managed VMIDs from SIDs like "vm:100" or "ct:200"
  const haManagedVmids = new Set<number>();
  for (const r of haResources) {
    if (!r.sid) continue;
    const match = r.sid.match(/^(?:vm|ct):(\d+)$/);
    if (match) haManagedVmids.add(Number(match[1]));
  }

  if (haManagedVmids.size === 0) {
    findings.push({
      severity: 'info',
      title: 'No HA-managed VMs to audit',
      detail: 'No VMs or containers are configured with HA management',
      relatedProbes: ['proxmox.cluster.ha.status'],
    });
    return buildResult(
      'proxmox-storage',
      findings,
      probeResults,
      startTime,
      '0 HA-managed VMs audited, 0 using local storage',
    );
  }

  // Get config for each HA-managed VM
  const haVMs = allVMs.filter((vm) => vm.vmid != null && haManagedVmids.has(vm.vmid));

  // Group 2: get config for each HA VM (parallel)
  const configResults = await Promise.all(
    haVMs.map(async (vm) => {
      const probe = vm.type === 'qemu' ? 'proxmox.vm.config' : 'proxmox.lxc.config';
      const r = await runProbe(probe, { vmid: vm.vmid, node: vm.node });
      storeResult(probeResults, { ...r, probe: `${probe}:${vm.vmid}` });
      return { vm, result: r };
    }),
  );

  // Group 3: get storage for each unique node (parallel)
  const uniqueNodes = [...new Set(haVMs.map((vm) => vm.node).filter(Boolean))] as string[];
  const nodeStorageMap = new Map<
    string,
    Array<{ storage?: string; shared?: boolean; active?: boolean }>
  >();

  await Promise.all(
    uniqueNodes.map(async (nodeName) => {
      const r = await runProbe('proxmox.node.storage', { node: nodeName });
      storeResult(probeResults, { ...r, probe: `proxmox.node.storage:${nodeName}` });
      const storData = probeData<{
        storages?: Array<{ storage?: string; shared?: boolean; active?: boolean }>;
      }>(r);
      nodeStorageMap.set(nodeName, storData?.storages ?? []);
    }),
  );

  // Cross-reference: check each HA VM's disk storage against shared flag
  let localCount = 0;
  for (const { vm, result } of configResults) {
    const configData = probeData<{
      disks?: Array<{ key: string; storage: string }>;
      rootfs?: { storage: string };
      mountpoints?: Array<{ key: string; storage: string }>;
    }>(result);
    if (!configData) continue;

    const nodeStorages = nodeStorageMap.get(vm.node ?? '') ?? [];

    // Collect disk entries
    const diskEntries: Array<{ key: string; storage: string }> = [];
    if (vm.type === 'qemu' && configData.disks) {
      for (const d of configData.disks) diskEntries.push(d);
    } else if (vm.type === 'lxc') {
      if (configData.rootfs)
        diskEntries.push({ key: 'rootfs', storage: configData.rootfs.storage });
      if (configData.mountpoints) {
        for (const mp of configData.mountpoints) diskEntries.push(mp);
      }
    }

    for (const disk of diskEntries) {
      const stor = nodeStorages.find((s) => s.storage === disk.storage);
      if (stor && !stor.shared) {
        localCount++;
        const sharedStor = nodeStorages.find((s) => s.shared && s.active);
        const moveCmd =
          vm.type === 'qemu'
            ? `qm move-disk ${vm.vmid} ${disk.key} ${sharedStor?.storage ?? '<shared-storage>'} --delete`
            : `pct move-volume ${vm.vmid} ${disk.key} ${sharedStor?.storage ?? '<shared-storage>'}`;
        findings.push({
          severity: 'critical',
          title: `VM ${vm.vmid} (${vm.name ?? 'unknown'}) uses local storage ${disk.storage} for ${disk.key}`,
          detail: `HA-managed VM ${vm.vmid} has disk "${disk.key}" on local storage "${disk.storage}". HA failover will fail for this disk.`,
          remediation: moveCmd,
          relatedProbes: [
            'proxmox.cluster.ha.status',
            vm.type === 'qemu' ? `proxmox.vm.config:${vm.vmid}` : `proxmox.lxc.config:${vm.vmid}`,
            `proxmox.node.storage:${vm.node}`,
          ],
        });
      }
    }
  }

  if (findings.length === 0) {
    findings.push({
      severity: 'info',
      title: `All ${haManagedVmids.size} HA-managed VMs use shared storage`,
      detail: 'No local storage risks detected for HA-managed VMs',
      relatedProbes: ['proxmox.cluster.ha.status', 'proxmox.cluster.resources'],
    });
  }

  return buildResult(
    'proxmox-storage',
    findings,
    probeResults,
    startTime,
    `${haManagedVmids.size} HA-managed VMs audited, ${localCount} using local storage`,
  );
}

// --- Export ---

export const proxmoxDiagnosticRunbooks: DiagnosticRunbookDefinition[] = [
  {
    category: 'proxmox-vm',
    description: 'Check the health of a specific VM or container',
    params: {
      vmid: { type: 'number', description: 'VM or container ID', required: true },
    },
    handler: vmHealthHandler,
  },
  {
    category: 'proxmox-cluster',
    description: 'Fleet-wide Proxmox cluster health overview',
    params: {
      limit: {
        type: 'number',
        description: 'Max recent tasks to check (default: 20)',
        required: false,
      },
    },
    handler: clusterHealthHandler,
  },
  {
    category: 'proxmox-storage',
    description: 'Audit which VMs have local-only disks that would break HA',
    handler: storageAuditHandler,
  },
];
