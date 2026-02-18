import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
  IntegrationProbeHandler,
} from '@sonde/shared';

// --- Auth helpers ---

/** Build Proxmox PVEAPIToken auth header */
export function buildAuthHeaders(credentials: IntegrationCredentials): Record<string, string> {
  const tokenId = credentials.credentials.tokenId ?? '';
  const tokenSecret = credentials.credentials.tokenSecret ?? '';
  return { Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}` };
}

// --- Proxmox REST helper ---

function proxmoxUrl(endpoint: string, path: string, params?: Record<string, string>): string {
  const base = `${endpoint.replace(/\/$/, '')}/api2/json${path}`;
  const url = new URL(base);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/** GET a Proxmox API endpoint, returns parsed JSON */
export async function proxmoxGet(
  path: string,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
  params?: Record<string, string>,
): Promise<unknown> {
  const url = proxmoxUrl(config.endpoint, path, params);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...buildAuthHeaders(credentials),
    ...config.headers,
  };

  const res = await fetchFn(url, { headers });
  if (!res.ok) throw new Error(`Proxmox API returned ${res.status}: ${res.statusText}`);
  return res.json();
}

// --- Node resolver ---

/** Resolve which node a VM/container lives on by querying cluster resources */
export async function resolveNode(
  vmid: number,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
): Promise<{ node: string; type: 'qemu' | 'lxc' }> {
  const data = (await proxmoxGet('/cluster/resources', config, credentials, fetchFn, {
    type: 'vm',
  })) as { data?: Array<{ vmid?: number; node?: string; type?: string }> };

  const entry = (data.data ?? []).find((r) => r.vmid === vmid);
  if (!entry || !entry.node) {
    throw new Error(`VM/container ${vmid} not found in cluster`);
  }
  return { node: entry.node, type: entry.type as 'qemu' | 'lxc' };
}

// --- Probe handlers ---

const clusterStatus: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = (await proxmoxGet('/cluster/status', config, credentials, fetchFn)) as {
    data?: Array<{
      name?: string;
      type?: string;
      online?: number;
      ip?: string;
      quorate?: number;
      nodeid?: number;
    }>;
  };

  const entries = data.data ?? [];
  const clusterEntry = entries.find((e) => e.type === 'cluster');
  const nodeEntries = entries.filter((e) => e.type === 'node');

  const warnings: string[] = [];
  if (clusterEntry && !clusterEntry.quorate) {
    warnings.push('Cluster has lost quorum');
  }
  for (const n of nodeEntries) {
    if (!n.online) {
      warnings.push(`Node ${n.name} is offline`);
    }
  }

  return {
    clusterName: clusterEntry?.name ?? null,
    quorate: !!clusterEntry?.quorate,
    nodes: nodeEntries.map((n) => ({
      name: n.name,
      online: !!n.online,
      ip: n.ip ?? null,
      type: n.type,
    })),
    warnings,
  };
};

const clusterHaStatus: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const [statusData, resourcesData] = await Promise.all([
    proxmoxGet('/cluster/ha/status/current', config, credentials, fetchFn) as Promise<{
      data?: Array<{ id?: string; type?: string; status?: string; node?: string; state?: string }>;
    }>,
    proxmoxGet('/cluster/ha/resources', config, credentials, fetchFn) as Promise<{
      data?: Array<{
        sid?: string;
        state?: string;
        node?: string;
        type?: string;
        group?: string;
        status?: string;
      }>;
    }>,
  ]);

  const statusEntries = statusData.data ?? [];
  const managerEntry = statusEntries.find((e) => e.type === 'manager' || e.id === 'manager');
  const resources = resourcesData.data ?? [];

  const warnings: string[] = [];
  for (const r of resources) {
    if (r.state === 'error' || r.state === 'fence') {
      warnings.push(`HA resource ${r.sid} in ${r.state} state`);
    }
  }

  return {
    managerStatus: managerEntry?.status ?? managerEntry?.state ?? null,
    resources: resources.map((r) => ({
      sid: r.sid,
      state: r.state,
      node: r.node,
      type: r.type,
      group: r.group ?? null,
    })),
    warnings,
  };
};

const nodesList: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = (await proxmoxGet('/nodes', config, credentials, fetchFn)) as {
    data?: Array<{
      node?: string;
      status?: string;
      uptime?: number;
      cpu?: number;
      maxcpu?: number;
      mem?: number;
      maxmem?: number;
      loadavg?: string;
    }>;
  };

  const nodes = data.data ?? [];
  const warnings: string[] = [];

  for (const n of nodes) {
    if (n.status === 'offline') {
      warnings.push(`Node ${n.node} is offline`);
    }
    if (n.cpu != null && n.cpu > 0.9) {
      warnings.push(`Node ${n.node} CPU at ${Math.round(n.cpu * 100)}%`);
    }
    if (n.mem != null && n.maxmem != null && n.maxmem > 0 && n.mem / n.maxmem > 0.9) {
      warnings.push(`Node ${n.node} memory at ${Math.round((n.mem / n.maxmem) * 100)}%`);
    }
  }

  return {
    nodes: nodes.map((n) => ({
      node: n.node,
      status: n.status,
      uptime: n.uptime ?? 0,
      cpu: n.cpu ?? 0,
      maxcpu: n.maxcpu ?? 0,
      mem: n.mem ?? 0,
      maxmem: n.maxmem ?? 0,
      loadavg: n.loadavg ?? null,
    })),
    warnings,
  };
};

const nodeStorage: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const node = params?.node as string;
  if (!node) throw new Error('node parameter is required');

  const data = (await proxmoxGet(`/nodes/${node}/storage`, config, credentials, fetchFn)) as {
    data?: Array<{
      storage?: string;
      type?: string;
      total?: number;
      used?: number;
      avail?: number;
      shared?: number;
      enabled?: number;
      active?: number;
    }>;
  };

  const storages = data.data ?? [];
  const warnings: string[] = [];

  for (const s of storages) {
    if (s.total && s.used && s.total > 0 && s.used / s.total > 0.85) {
      warnings.push(`Storage ${s.storage} is ${Math.round((s.used / s.total) * 100)}% used`);
    }
    if (s.enabled === 0) {
      warnings.push(`Storage ${s.storage} is disabled`);
    }
    if (s.active === 0 && s.enabled !== 0) {
      warnings.push(`Storage ${s.storage} is inactive`);
    }
  }

  return {
    storages: storages.map((s) => ({
      storage: s.storage,
      type: s.type,
      total: s.total ?? 0,
      used: s.used ?? 0,
      avail: s.avail ?? 0,
      shared: !!s.shared,
      enabled: s.enabled !== 0,
      active: s.active !== 0,
    })),
    warnings,
  };
};

const vmStatus: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const vmid = params?.vmid as number;
  if (vmid == null) throw new Error('vmid parameter is required');

  const data = (await proxmoxGet('/cluster/resources', config, credentials, fetchFn, {
    type: 'vm',
  })) as {
    data?: Array<{
      vmid?: number;
      name?: string;
      status?: string;
      node?: string;
      type?: string;
      uptime?: number;
      cpu?: number;
      mem?: number;
      maxmem?: number;
      lock?: string;
      hastate?: string;
    }>;
  };

  const vm = (data.data ?? []).find((r) => r.vmid === vmid);
  if (!vm) throw new Error(`VM/container ${vmid} not found in cluster`);

  const warnings: string[] = [];
  if (vm.status === 'stopped') {
    warnings.push('VM is stopped');
  }
  if (vm.lock) {
    warnings.push(`VM has lock: ${vm.lock}`);
  }
  if (vm.hastate && vm.hastate !== 'managed' && vm.hastate !== 'started') {
    warnings.push(`HA state: ${vm.hastate}`);
  }

  return {
    vmid: vm.vmid,
    name: vm.name,
    status: vm.status,
    node: vm.node,
    type: vm.type,
    uptime: vm.uptime ?? 0,
    cpu: vm.cpu ?? 0,
    mem: vm.mem ?? 0,
    maxmem: vm.maxmem ?? 0,
    lock: vm.lock ?? null,
    hastate: vm.hastate ?? null,
    warnings,
  };
};

const vmConfig: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const vmid = params?.vmid as number;
  if (vmid == null) throw new Error('vmid parameter is required');

  let node = params?.node as string | undefined;
  if (!node) {
    const resolved = await resolveNode(vmid, config, credentials, fetchFn);
    node = resolved.node;
  }

  const data = (await proxmoxGet(
    `/nodes/${node}/qemu/${vmid}/config`,
    config,
    credentials,
    fetchFn,
  )) as { data?: Record<string, unknown> };

  const cfg = data.data ?? {};
  const diskKeys = ['scsi', 'ide', 'virtio', 'sata', 'efidisk', 'tpmstate'];
  const disks: Array<{ key: string; storage: string; format: string; size: string }> = [];

  for (const [key, value] of Object.entries(cfg)) {
    if (typeof value !== 'string') continue;
    const matchesDisk = diskKeys.some((prefix) => key.startsWith(prefix));
    if (!matchesDisk) continue;

    // Parse: "local-lvm:vm-100-disk-0,size=32G" or "local:iso/file.iso,media=cdrom"
    const colonIdx = value.indexOf(':');
    if (colonIdx === -1) continue;

    const storage = value.slice(0, colonIdx);
    const rest = value.slice(colonIdx + 1);
    const commaIdx = rest.indexOf(',');
    const volPart = commaIdx > -1 ? rest.slice(0, commaIdx) : rest;
    const optsPart = commaIdx > -1 ? rest.slice(commaIdx + 1) : '';

    // Extract format from volume name or options
    let format = 'raw';
    if (volPart.endsWith('.qcow2')) format = 'qcow2';
    else if (volPart.endsWith('.vmdk')) format = 'vmdk';
    else if (optsPart.includes('format=qcow2')) format = 'qcow2';
    else if (optsPart.includes('format=vmdk')) format = 'vmdk';
    else if (optsPart.includes('format=raw')) format = 'raw';

    // Extract size
    const sizeMatch = optsPart.match(/size=(\S+)/);
    const size = sizeMatch?.[1] ?? '';

    disks.push({ key, storage, format, size });
  }

  const warnings: string[] = [];
  // Warn if local storage on potentially HA-managed VM
  for (const d of disks) {
    if (d.storage === 'local' || d.storage === 'local-lvm') {
      warnings.push(`Disk ${d.key} uses local storage (${d.storage}) — not shared for HA`);
    }
  }

  return {
    vmid,
    node,
    config: cfg,
    disks,
    warnings,
  };
};

const vmSnapshots: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const vmid = params?.vmid as number;
  if (vmid == null) throw new Error('vmid parameter is required');

  let node = params?.node as string | undefined;
  if (!node) {
    const resolved = await resolveNode(vmid, config, credentials, fetchFn);
    node = resolved.node;
  }

  const data = (await proxmoxGet(
    `/nodes/${node}/qemu/${vmid}/snapshot`,
    config,
    credentials,
    fetchFn,
  )) as {
    data?: Array<{
      name?: string;
      description?: string;
      snaptime?: number;
      parent?: string;
    }>;
  };

  const snapshots = (data.data ?? []).filter((s) => s.name !== 'current');
  const now = Date.now() / 1000;
  const sevenDays = 7 * 24 * 60 * 60;

  const warnings: string[] = [];
  for (const s of snapshots) {
    if (s.snaptime && now - s.snaptime > sevenDays) {
      warnings.push(`Snapshot "${s.name}" is older than 7 days`);
    }
  }

  return {
    vmid,
    node,
    snapshots: snapshots.map((s) => ({
      name: s.name,
      description: s.description ?? '',
      snaptime: s.snaptime ?? null,
      parent: s.parent ?? null,
    })),
    warnings,
  };
};

const storageContent: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const node = params?.node as string;
  const storage = params?.storage as string;
  if (!node) throw new Error('node parameter is required');
  if (!storage) throw new Error('storage parameter is required');

  const vmidFilter = params?.vmid as number | undefined;

  const data = (await proxmoxGet(
    `/nodes/${node}/storage/${storage}/content`,
    config,
    credentials,
    fetchFn,
  )) as {
    data?: Array<{
      volid?: string;
      vmid?: number;
      size?: number;
      format?: string;
    }>;
  };

  let volumes = data.data ?? [];
  if (vmidFilter != null) {
    volumes = volumes.filter((v) => v.vmid === vmidFilter);
  }

  return {
    volumes: volumes.map((v) => ({
      volid: v.volid,
      vmid: v.vmid ?? null,
      size: v.size ?? 0,
      format: v.format ?? null,
    })),
    count: volumes.length,
  };
};

const clusterTasks: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const vmidFilter = params?.vmid as number | undefined;
  const limit = (params?.limit as number) || 50;

  const data = (await proxmoxGet('/cluster/tasks', config, credentials, fetchFn)) as {
    data?: Array<{
      upid?: string;
      type?: string;
      status?: string;
      starttime?: number;
      endtime?: number;
      node?: string;
      user?: string;
      id?: string;
    }>;
  };

  let tasks = data.data ?? [];

  if (vmidFilter != null) {
    const vmidStr = String(vmidFilter);
    tasks = tasks.filter((t) => t.id === vmidStr);
  }

  tasks = tasks.slice(0, limit);

  const warnings: string[] = [];
  for (const t of tasks) {
    if (t.status && t.status !== 'OK' && t.status !== '' && t.endtime) {
      warnings.push(`Task ${t.type} on ${t.node} failed: ${t.status}`);
    }
    if (t.type === 'qmigrate' && !t.endtime) {
      warnings.push(`Migration in progress on ${t.node}`);
    }
  }

  return {
    tasks: tasks.map((t) => ({
      upid: t.upid,
      type: t.type,
      status: t.status ?? null,
      starttime: t.starttime ?? null,
      endtime: t.endtime ?? null,
      node: t.node,
      user: t.user ?? null,
    })),
    warnings,
  };
};

const nodeLvm: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const node = params?.node as string;
  if (!node) throw new Error('node parameter is required');

  const data = (await proxmoxGet(`/nodes/${node}/disks/lvm`, config, credentials, fetchFn)) as {
    data?: Array<{
      name?: string;
      size?: number;
      free?: number;
      pvs?: number;
      lvs?: number;
      children?: unknown[];
    }>;
  };

  const volumeGroups = data.data ?? [];
  const warnings: string[] = [];

  for (const vg of volumeGroups) {
    if (vg.free != null && vg.free === 0) {
      warnings.push(`Volume group ${vg.name} has no free space`);
    }
  }

  return {
    volumeGroups: volumeGroups.map((vg) => ({
      name: vg.name,
      size: vg.size ?? 0,
      free: vg.free ?? 0,
      pvs: vg.pvs ?? 0,
      lvs: vg.lvs ?? 0,
    })),
    warnings,
  };
};

const lxcStatus: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const vmid = params?.vmid as number;
  if (vmid == null) throw new Error('vmid parameter is required');

  let node = params?.node as string | undefined;
  if (!node) {
    const resolved = await resolveNode(vmid, config, credentials, fetchFn);
    if (resolved.type !== 'lxc') {
      throw new Error(`VMID ${vmid} is not an LXC container (type: ${resolved.type})`);
    }
    node = resolved.node;
  }

  const data = (await proxmoxGet(
    `/nodes/${node}/lxc/${vmid}/status/current`,
    config,
    credentials,
    fetchFn,
  )) as {
    data?: {
      vmid?: number;
      name?: string;
      status?: string;
      uptime?: number;
      cpu?: number;
      mem?: number;
      maxmem?: number;
      disk?: number;
      maxdisk?: number;
      swap?: number;
      maxswap?: number;
    };
  };

  const ct = data.data ?? {};
  const warnings: string[] = [];
  if (ct.status === 'stopped') {
    warnings.push('Container is stopped');
  }

  return {
    vmid: ct.vmid ?? vmid,
    name: ct.name ?? null,
    status: ct.status ?? null,
    node,
    uptime: ct.uptime ?? 0,
    cpu: ct.cpu ?? 0,
    mem: ct.mem ?? 0,
    maxmem: ct.maxmem ?? 0,
    disk: ct.disk ?? 0,
    maxdisk: ct.maxdisk ?? 0,
    swap: ct.swap ?? 0,
    maxswap: ct.maxswap ?? 0,
    warnings,
  };
};

const lxcConfig: IntegrationProbeHandler = async (params, config, credentials, fetchFn) => {
  const vmid = params?.vmid as number;
  if (vmid == null) throw new Error('vmid parameter is required');

  let node = params?.node as string | undefined;
  if (!node) {
    const resolved = await resolveNode(vmid, config, credentials, fetchFn);
    node = resolved.node;
  }

  const data = (await proxmoxGet(
    `/nodes/${node}/lxc/${vmid}/config`,
    config,
    credentials,
    fetchFn,
  )) as { data?: Record<string, unknown> };

  const cfg = data.data ?? {};

  // Parse rootfs: "local-lvm:subvol-200-disk-0,size=8G"
  let rootfs: { storage: string; size: string } | null = null;
  if (typeof cfg.rootfs === 'string') {
    const colonIdx = (cfg.rootfs as string).indexOf(':');
    if (colonIdx > -1) {
      const storage = (cfg.rootfs as string).slice(0, colonIdx);
      const rest = (cfg.rootfs as string).slice(colonIdx + 1);
      const sizeMatch = rest.match(/size=(\S+)/);
      rootfs = { storage, size: sizeMatch?.[1] ?? '' };
    }
  }

  // Parse mp0–mp9 mountpoints
  const mountpoints: Array<{ key: string; storage: string; mountpoint: string; size: string }> = [];
  for (const [key, value] of Object.entries(cfg)) {
    if (!/^mp\d+$/.test(key) || typeof value !== 'string') continue;
    const colonIdx = value.indexOf(':');
    if (colonIdx === -1) continue;

    const storage = value.slice(0, colonIdx);
    const rest = value.slice(colonIdx + 1);
    const mpMatch = rest.match(/mp=([^,]+)/);
    const sizeMatch = rest.match(/size=(\S+)/);
    mountpoints.push({
      key,
      storage,
      mountpoint: mpMatch?.[1] ?? '',
      size: sizeMatch?.[1] ?? '',
    });
  }

  const warnings: string[] = [];

  return {
    vmid,
    node,
    config: cfg,
    rootfs,
    mountpoints,
    warnings,
  };
};

const clusterResources: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  const data = (await proxmoxGet('/cluster/resources', config, credentials, fetchFn, {
    type: 'vm',
  })) as {
    data?: Array<{
      vmid?: number;
      name?: string;
      node?: string;
      type?: string;
      status?: string;
      uptime?: number;
      cpu?: number;
      mem?: number;
      maxmem?: number;
      hastate?: string;
      lock?: string;
    }>;
  };

  const resources = data.data ?? [];
  return {
    resources: resources.map((r) => ({
      vmid: r.vmid,
      name: r.name ?? null,
      node: r.node,
      type: r.type,
      status: r.status,
      uptime: r.uptime ?? 0,
      cpu: r.cpu ?? 0,
      mem: r.mem ?? 0,
      maxmem: r.maxmem ?? 0,
      hastate: r.hastate ?? null,
      lock: r.lock ?? null,
    })),
  };
};

const cephStatus: IntegrationProbeHandler = async (_params, config, credentials, fetchFn) => {
  let statusData: {
    data?: {
      health?: { status?: string };
      osdmap?: { osdmap?: { num_osds?: number; num_up_osds?: number; num_in_osds?: number } };
      pgmap?: {
        pgs_by_state?: Array<{ state_name?: string; count?: number }>;
        bytes_total?: number;
        bytes_used?: number;
        bytes_avail?: number;
      };
    };
  };

  try {
    statusData = (await proxmoxGet(
      '/cluster/ceph/status',
      config,
      credentials,
      fetchFn,
    )) as typeof statusData;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('404') || msg.includes('501')) {
      return {
        available: false,
        health: null,
        warnings: ['Ceph is not configured on this cluster'],
      };
    }
    throw err;
  }

  const ceph = statusData.data ?? {};
  const osdmap = ceph.osdmap?.osdmap ?? {};
  const pgmap = ceph.pgmap ?? {};
  const health = ceph.health?.status ?? 'unknown';

  const warnings: string[] = [];
  if (health !== 'HEALTH_OK') {
    warnings.push(`Ceph health: ${health}`);
  }

  const osdCount = osdmap.num_osds ?? 0;
  const osdUp = osdmap.num_up_osds ?? 0;
  if (osdCount > 0 && osdUp < osdCount) {
    warnings.push(`${osdCount - osdUp} OSD(s) down`);
  }

  // Try to get OSD details from first node
  let osds: Array<{ id: number; name: string; status: string }> = [];
  try {
    // Get nodes list to find first available node
    const nodesData = (await proxmoxGet('/nodes', config, credentials, fetchFn)) as {
      data?: Array<{ node?: string; status?: string }>;
    };
    const firstNode = (nodesData.data ?? []).find((n) => n.status === 'online');
    if (firstNode?.node) {
      const osdData = (await proxmoxGet(
        `/nodes/${firstNode.node}/ceph/osd`,
        config,
        credentials,
        fetchFn,
      )) as {
        data?: Array<{ id?: number; name?: string; status?: string; in?: number; up?: number }>;
      };
      osds = (osdData.data ?? []).map((o) => ({
        id: o.id ?? 0,
        name: o.name ?? `osd.${o.id ?? 0}`,
        status: o.up ? 'up' : 'down',
      }));
    }
  } catch {
    // OSD detail is best-effort
  }

  return {
    available: true,
    health,
    osdCount,
    osdUp,
    osdIn: osdmap.num_in_osds ?? 0,
    pgStates: (pgmap.pgs_by_state ?? []).map((p) => ({
      state: p.state_name,
      count: p.count,
    })),
    usage: {
      total: pgmap.bytes_total ?? 0,
      used: pgmap.bytes_used ?? 0,
      avail: pgmap.bytes_avail ?? 0,
    },
    osds,
    warnings,
  };
};

// --- Pack definition ---

export const proxmoxPack: IntegrationPack = {
  manifest: {
    name: 'proxmox',
    type: 'integration',
    version: '0.1.0',
    description: 'Proxmox VE cluster — nodes, VMs, containers, storage, Ceph, and HA status',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'cluster.status',
        description: 'Cluster status including quorum and node health',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'cluster.ha.status',
        description: 'HA manager status and resource states',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'nodes.list',
        description: 'List all nodes with CPU, memory, and status',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
      {
        name: 'node.storage',
        description: 'Storage pools for a specific node',
        capability: 'observe',
        params: {
          node: { type: 'string', description: 'Node name', required: true },
        },
        timeout: 15000,
      },
      {
        name: 'vm.status',
        description: 'VM status by VMID (searches cluster-wide)',
        capability: 'observe',
        params: {
          vmid: { type: 'number', description: 'VM ID', required: true },
        },
        timeout: 15000,
      },
      {
        name: 'vm.config',
        description: 'VM configuration with parsed disk entries',
        capability: 'observe',
        params: {
          vmid: { type: 'number', description: 'VM ID', required: true },
          node: {
            type: 'string',
            description: 'Node name (auto-resolved if omitted)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'vm.snapshots',
        description: 'VM snapshots with age warnings',
        capability: 'observe',
        params: {
          vmid: { type: 'number', description: 'VM ID', required: true },
          node: {
            type: 'string',
            description: 'Node name (auto-resolved if omitted)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'storage.content',
        description: 'List volumes in a storage pool',
        capability: 'observe',
        params: {
          node: { type: 'string', description: 'Node name', required: true },
          storage: { type: 'string', description: 'Storage ID', required: true },
          vmid: {
            type: 'number',
            description: 'Filter by VM ID',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'cluster.tasks',
        description: 'Recent cluster tasks with failure detection',
        capability: 'observe',
        params: {
          vmid: {
            type: 'number',
            description: 'Filter by VM ID',
            required: false,
          },
          limit: {
            type: 'number',
            description: 'Max results (default: 50)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'node.lvm',
        description: 'LVM volume groups on a node',
        capability: 'observe',
        params: {
          node: { type: 'string', description: 'Node name', required: true },
        },
        timeout: 15000,
      },
      {
        name: 'lxc.status',
        description: 'LXC container status with resource usage',
        capability: 'observe',
        params: {
          vmid: { type: 'number', description: 'Container VMID', required: true },
          node: {
            type: 'string',
            description: 'Node name (auto-resolved if omitted)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'lxc.config',
        description: 'LXC container configuration with parsed mountpoints',
        capability: 'observe',
        params: {
          vmid: { type: 'number', description: 'Container VMID', required: true },
          node: {
            type: 'string',
            description: 'Node name (auto-resolved if omitted)',
            required: false,
          },
        },
        timeout: 15000,
      },
      {
        name: 'ceph.status',
        description: 'Ceph cluster health, OSD status, and usage',
        capability: 'observe',
        params: {},
        timeout: 30000,
      },
      {
        name: 'cluster.resources',
        description: 'List all VMs and containers across the cluster',
        capability: 'observe',
        params: {},
        timeout: 15000,
      },
    ],
    runbook: {
      category: 'virtualization',
      probes: ['cluster.status', 'nodes.list', 'ceph.status'],
      parallel: true,
    },
  },

  handlers: {
    'cluster.status': clusterStatus,
    'cluster.ha.status': clusterHaStatus,
    'nodes.list': nodesList,
    'node.storage': nodeStorage,
    'vm.status': vmStatus,
    'vm.config': vmConfig,
    'vm.snapshots': vmSnapshots,
    'storage.content': storageContent,
    'cluster.tasks': clusterTasks,
    'node.lvm': nodeLvm,
    'lxc.status': lxcStatus,
    'lxc.config': lxcConfig,
    'ceph.status': cephStatus,
    'cluster.resources': clusterResources,
  },

  testConnection: async (config, credentials, fetchFn) => {
    try {
      const url = proxmoxUrl(config.endpoint, '/version');
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...buildAuthHeaders(credentials),
        ...config.headers,
      };

      const res = await fetchFn(url, { headers });
      return res.ok;
    } catch {
      return false;
    }
  },
};
