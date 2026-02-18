import { describe, expect, it } from 'vitest';
import type { RunProbe, RunbookContext, RunbookProbeResult } from '../types.js';
import { proxmoxDiagnosticRunbooks } from './proxmox.js';

// --- Test helpers ---

function getHandler(category: string) {
  const def = proxmoxDiagnosticRunbooks.find((r) => r.category === category);
  if (!def) throw new Error(`No runbook for category "${category}"`);
  return def.handler;
}

function mockResult(
  probe: string,
  data: unknown,
  status: 'success' | 'error' | 'timeout' = 'success',
  error?: string,
): RunbookProbeResult {
  return { probe, status, data, durationMs: 10, error };
}

/** Create a mock runProbe that returns canned data keyed by probe name */
function createMockRunProbe(
  responses: Record<
    string,
    { data?: unknown; status?: 'success' | 'error' | 'timeout'; error?: string }
  >,
): RunProbe {
  return async (probe: string, _params?: Record<string, unknown>, _agent?: string) => {
    const key = probe;
    const response = responses[key];
    if (!response) {
      return mockResult(probe, undefined, 'error', `No mock for probe ${probe}`);
    }
    return mockResult(probe, response.data, response.status ?? 'success', response.error);
  };
}

const defaultContext: RunbookContext = { connectedAgents: [] };

// --- Healthy cluster data fixtures ---

const healthyClusterStatus = {
  clusterName: 'prod',
  quorate: true,
  nodes: [
    { name: 'pve01', online: true },
    { name: 'pve02', online: true },
  ],
  warnings: [],
};

const healthyHaStatus = {
  managerStatus: 'active',
  resources: [{ sid: 'vm:100', state: 'started', node: 'pve01', type: 'vm' }],
  warnings: [],
};

const healthyVmStatus = {
  vmid: 100,
  name: 'web-01',
  status: 'running',
  node: 'pve01',
  type: 'qemu',
  uptime: 86400,
  cpu: 0.1,
  mem: 2e9,
  maxmem: 4e9,
  lock: null,
  hastate: 'managed',
  warnings: [],
};

const healthyVmConfig = {
  vmid: 100,
  node: 'pve01',
  config: {},
  disks: [{ key: 'scsi0', storage: 'ceph-pool', format: 'raw', size: '32G' }],
  warnings: [],
};

const healthyNodeStorage = {
  storages: [
    {
      storage: 'local',
      type: 'dir',
      total: 100e9,
      used: 40e9,
      avail: 60e9,
      shared: false,
      enabled: true,
      active: true,
    },
    {
      storage: 'local-lvm',
      type: 'lvmthin',
      total: 500e9,
      used: 100e9,
      avail: 400e9,
      shared: false,
      enabled: true,
      active: true,
    },
    {
      storage: 'ceph-pool',
      type: 'rbd',
      total: 1e12,
      used: 200e9,
      avail: 800e9,
      shared: true,
      enabled: true,
      active: true,
    },
  ],
  warnings: [],
};

const emptyTasks = { tasks: [], warnings: [] };

// =============================================================================
// proxmox-vm-health tests
// =============================================================================

describe('proxmox-vm-health', () => {
  const handler = getHandler('proxmox-vm');

  it('healthy QEMU VM — all probes good', async () => {
    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: healthyClusterStatus },
      'proxmox.cluster.ha.status': { data: healthyHaStatus },
      'proxmox.vm.status': { data: healthyVmStatus },
      'proxmox.cluster.tasks': { data: emptyTasks },
      'proxmox.vm.config': { data: healthyVmConfig },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({ vmid: 100 }, runProbe, defaultContext);

    expect(result.category).toBe('proxmox-vm');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('info');
    expect(result.findings[0]?.title).toContain('VM 100 is healthy');
    expect(result.summary.probesRun).toBeGreaterThanOrEqual(6);
  });

  it('healthy LXC container — routes to lxc.config', async () => {
    const lxcVmStatus = { ...healthyVmStatus, vmid: 200, type: 'lxc', name: 'ct-db' };
    const lxcConfig = {
      vmid: 200,
      node: 'pve01',
      config: {},
      rootfs: { storage: 'ceph-pool', size: '8G' },
      mountpoints: [],
      warnings: [],
    };
    const haNoResources = { ...healthyHaStatus, resources: [] };

    const calls: string[] = [];
    const runProbe: RunProbe = async (probe, _params, _agent) => {
      calls.push(probe);
      const responses: Record<string, unknown> = {
        'proxmox.cluster.status': healthyClusterStatus,
        'proxmox.cluster.ha.status': haNoResources,
        'proxmox.vm.status': lxcVmStatus,
        'proxmox.cluster.tasks': emptyTasks,
        'proxmox.lxc.config': lxcConfig,
        'proxmox.node.storage': healthyNodeStorage,
      };
      return mockResult(probe, responses[probe]);
    };

    const result = await handler({ vmid: 200 }, runProbe, defaultContext);

    expect(calls).toContain('proxmox.lxc.config');
    expect(calls).not.toContain('proxmox.vm.config');
    expect(result.findings.some((f) => f.severity === 'info')).toBe(true);
  });

  it('HA error state — critical finding with ha-manager remediation', async () => {
    const haError = {
      ...healthyHaStatus,
      resources: [{ sid: 'vm:100', state: 'error', node: 'pve01', type: 'vm' }],
    };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: healthyClusterStatus },
      'proxmox.cluster.ha.status': { data: haError },
      'proxmox.vm.status': { data: healthyVmStatus },
      'proxmox.cluster.tasks': { data: emptyTasks },
      'proxmox.vm.config': { data: healthyVmConfig },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({ vmid: 100 }, runProbe, defaultContext);

    const critical = result.findings.filter((f) => f.severity === 'critical');
    expect(critical.length).toBeGreaterThanOrEqual(1);
    const haFinding = critical.find((f) => f.title.includes('HA error'));
    expect(haFinding).toBeDefined();
    expect(haFinding?.remediation).toContain('ha-manager set vm:100 --state disabled');
  });

  it('VM locked — warning with unlock remediation', async () => {
    const lockedVm = { ...healthyVmStatus, lock: 'backup' };
    const haNoResources = { ...healthyHaStatus, resources: [] };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: healthyClusterStatus },
      'proxmox.cluster.ha.status': { data: haNoResources },
      'proxmox.vm.status': { data: lockedVm },
      'proxmox.cluster.tasks': { data: emptyTasks },
      'proxmox.vm.config': { data: healthyVmConfig },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({ vmid: 100 }, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('stale lock'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
    expect(warning?.remediation).toContain('qm unlock 100');
  });

  it('local storage + HA — critical finding with qm move-disk', async () => {
    const localConfig = {
      ...healthyVmConfig,
      disks: [{ key: 'scsi0', storage: 'local-lvm', format: 'raw', size: '32G' }],
    };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: healthyClusterStatus },
      'proxmox.cluster.ha.status': { data: healthyHaStatus },
      'proxmox.vm.status': { data: healthyVmStatus },
      'proxmox.cluster.tasks': { data: emptyTasks },
      'proxmox.vm.config': { data: localConfig },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({ vmid: 100 }, runProbe, defaultContext);

    const critical = result.findings.find((f) =>
      f.title.includes('local storage but is HA-managed'),
    );
    expect(critical).toBeDefined();
    expect(critical?.severity).toBe('critical');
    expect(critical?.remediation).toContain('qm move-disk 100 scsi0 ceph-pool --delete');
  });

  it('storage inaccessible — critical finding', async () => {
    const inactiveStorage = {
      storages: [
        ...healthyNodeStorage.storages.map((s) =>
          s.storage === 'ceph-pool' ? { ...s, active: false } : s,
        ),
      ],
      warnings: [],
    };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: healthyClusterStatus },
      'proxmox.cluster.ha.status': { data: healthyHaStatus },
      'proxmox.vm.status': { data: healthyVmStatus },
      'proxmox.cluster.tasks': { data: emptyTasks },
      'proxmox.vm.config': { data: healthyVmConfig },
      'proxmox.node.storage': { data: inactiveStorage },
    });

    const result = await handler({ vmid: 100 }, runProbe, defaultContext);

    const critical = result.findings.find((f) => f.title.includes('not accessible'));
    expect(critical).toBeDefined();
    expect(critical?.severity).toBe('critical');
    expect(critical?.remediation).toContain('LVM/NFS');
  });

  it('failed recent tasks — warning finding', async () => {
    const failedTasks = {
      tasks: [
        {
          type: 'qmstart',
          status: 'ERROR: start failed',
          node: 'pve01',
          starttime: 1000,
          endtime: 1010,
        },
      ],
      warnings: [],
    };

    const haNoResources = { ...healthyHaStatus, resources: [] };
    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: healthyClusterStatus },
      'proxmox.cluster.ha.status': { data: haNoResources },
      'proxmox.vm.status': { data: healthyVmStatus },
      'proxmox.cluster.tasks': { data: failedTasks },
      'proxmox.vm.config': { data: healthyVmConfig },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({ vmid: 100 }, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('task failures'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('VM not found — handles error gracefully', async () => {
    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: healthyClusterStatus },
      'proxmox.cluster.ha.status': { data: healthyHaStatus },
      'proxmox.vm.status': { status: 'error', error: 'VM/container 999 not found' },
      'proxmox.cluster.tasks': { data: emptyTasks },
    });

    const result = await handler({ vmid: 999 }, runProbe, defaultContext);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('critical');
    expect(result.findings[0]?.title).toContain('not found');
  });

  it('agent available — calls agent probe when node matches', async () => {
    const haNoResources = { ...healthyHaStatus, resources: [] };
    const calls: Array<{ probe: string; agent?: string }> = [];
    const runProbe: RunProbe = async (probe, _params, agent) => {
      calls.push({ probe, agent });
      const responses: Record<string, unknown> = {
        'proxmox.cluster.status': healthyClusterStatus,
        'proxmox.cluster.ha.status': haNoResources,
        'proxmox.vm.status': healthyVmStatus,
        'proxmox.cluster.tasks': emptyTasks,
        'proxmox.vm.config': healthyVmConfig,
        'proxmox.node.storage': healthyNodeStorage,
        'proxmox-node.local.lvm': { volumeGroups: [], warnings: [] },
      };
      return mockResult(probe, responses[probe]);
    };

    const ctx: RunbookContext = { connectedAgents: ['pve01'] };
    await handler({ vmid: 100 }, runProbe, ctx);

    const agentCall = calls.find((c) => c.probe === 'proxmox-node.local.lvm');
    expect(agentCall).toBeDefined();
    expect(agentCall?.agent).toBe('pve01');
  });

  it('agent unavailable — skips agent probe silently', async () => {
    const haNoResources = { ...healthyHaStatus, resources: [] };
    const calls: string[] = [];
    const runProbe: RunProbe = async (probe) => {
      calls.push(probe);
      const responses: Record<string, unknown> = {
        'proxmox.cluster.status': healthyClusterStatus,
        'proxmox.cluster.ha.status': haNoResources,
        'proxmox.vm.status': healthyVmStatus,
        'proxmox.cluster.tasks': emptyTasks,
        'proxmox.vm.config': healthyVmConfig,
        'proxmox.node.storage': healthyNodeStorage,
      };
      return mockResult(probe, responses[probe]);
    };

    await handler({ vmid: 100 }, runProbe, defaultContext);

    expect(calls).not.toContain('proxmox-node.local.lvm');
  });

  it('VM stopped — warning finding', async () => {
    const stoppedVm = { ...healthyVmStatus, status: 'stopped' };
    const haNoResources = { ...healthyHaStatus, resources: [] };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: healthyClusterStatus },
      'proxmox.cluster.ha.status': { data: haNoResources },
      'proxmox.vm.status': { data: stoppedVm },
      'proxmox.cluster.tasks': { data: emptyTasks },
      'proxmox.vm.config': { data: healthyVmConfig },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({ vmid: 100 }, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('stopped'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('quorum lost — critical finding', async () => {
    const noQuorum = { ...healthyClusterStatus, quorate: false };
    const haNoResources = { ...healthyHaStatus, resources: [] };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: noQuorum },
      'proxmox.cluster.ha.status': { data: haNoResources },
      'proxmox.vm.status': { data: healthyVmStatus },
      'proxmox.cluster.tasks': { data: emptyTasks },
      'proxmox.vm.config': { data: healthyVmConfig },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({ vmid: 100 }, runProbe, defaultContext);

    const critical = result.findings.find((f) => f.title.includes('quorum'));
    expect(critical).toBeDefined();
    expect(critical?.severity).toBe('critical');
  });
});

// =============================================================================
// proxmox-cluster-health tests
// =============================================================================

describe('proxmox-cluster-health', () => {
  const handler = getHandler('proxmox-cluster');

  const healthyNodesList = {
    nodes: [
      { node: 'pve01', status: 'online', cpu: 0.25, mem: 4e9, maxmem: 16e9 },
      { node: 'pve02', status: 'online', cpu: 0.3, mem: 6e9, maxmem: 16e9 },
    ],
    warnings: [],
  };

  it('healthy cluster — no issues', async () => {
    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: healthyClusterStatus },
      'proxmox.nodes.list': { data: healthyNodesList },
      'proxmox.cluster.ha.status': { data: { ...healthyHaStatus, resources: [] } },
      'proxmox.cluster.tasks': { data: emptyTasks },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({}, runProbe, defaultContext);

    expect(result.category).toBe('proxmox-cluster');
    // All findings should be info or no critical/warning
    const issues = result.findings.filter((f) => f.severity !== 'info');
    expect(issues).toHaveLength(0);
    expect(result.summary.summaryText).toContain('2 nodes online');
  });

  it('offline node — critical finding', async () => {
    const nodeWithOffline = {
      nodes: [
        { node: 'pve01', status: 'online', cpu: 0.25, mem: 4e9, maxmem: 16e9 },
        { node: 'pve02', status: 'offline', cpu: 0, mem: 0, maxmem: 16e9 },
      ],
      warnings: [],
    };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: healthyClusterStatus },
      'proxmox.nodes.list': { data: nodeWithOffline },
      'proxmox.cluster.ha.status': { data: { ...healthyHaStatus, resources: [] } },
      'proxmox.cluster.tasks': { data: emptyTasks },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({}, runProbe, defaultContext);

    const critical = result.findings.find(
      (f) => f.title.includes('pve02') && f.title.includes('offline'),
    );
    expect(critical).toBeDefined();
    expect(critical?.severity).toBe('critical');
  });

  it('high CPU — warning per node', async () => {
    const highCpuNodes = {
      nodes: [{ node: 'pve01', status: 'online', cpu: 0.95, mem: 4e9, maxmem: 16e9 }],
      warnings: [],
    };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: healthyClusterStatus },
      'proxmox.nodes.list': { data: highCpuNodes },
      'proxmox.cluster.ha.status': { data: { ...healthyHaStatus, resources: [] } },
      'proxmox.cluster.tasks': { data: emptyTasks },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({}, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('CPU') && f.title.includes('95%'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('high memory — warning per node', async () => {
    const highMemNodes = {
      nodes: [{ node: 'pve01', status: 'online', cpu: 0.2, mem: 15e9, maxmem: 16e9 }],
      warnings: [],
    };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: healthyClusterStatus },
      'proxmox.nodes.list': { data: highMemNodes },
      'proxmox.cluster.ha.status': { data: { ...healthyHaStatus, resources: [] } },
      'proxmox.cluster.tasks': { data: emptyTasks },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({}, runProbe, defaultContext);

    const warning = result.findings.find(
      (f) => f.title.includes('memory') && f.title.includes('94%'),
    );
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('HA resources in error — critical with remediation', async () => {
    const haError = {
      resources: [{ sid: 'vm:100', state: 'error', node: 'pve01' }],
      warnings: [],
    };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: healthyClusterStatus },
      'proxmox.nodes.list': { data: healthyNodesList },
      'proxmox.cluster.ha.status': { data: haError },
      'proxmox.cluster.tasks': { data: emptyTasks },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({}, runProbe, defaultContext);

    const critical = result.findings.find((f) => f.title.includes('vm:100'));
    expect(critical).toBeDefined();
    expect(critical?.severity).toBe('critical');
    expect(critical?.remediation).toContain('ha-manager set vm:100 --state disabled');
  });

  it('storage > 85% — warning per storage', async () => {
    const fullStorage = {
      storages: [
        {
          storage: 'local',
          type: 'dir',
          total: 100e9,
          used: 90e9,
          avail: 10e9,
          shared: false,
          enabled: true,
          active: true,
        },
      ],
      warnings: [],
    };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: healthyClusterStatus },
      'proxmox.nodes.list': {
        data: {
          nodes: [{ node: 'pve01', status: 'online', cpu: 0.1, mem: 4e9, maxmem: 16e9 }],
          warnings: [],
        },
      },
      'proxmox.cluster.ha.status': { data: { resources: [], warnings: [] } },
      'proxmox.cluster.tasks': { data: emptyTasks },
      'proxmox.node.storage': { data: fullStorage },
    });

    const result = await handler({}, runProbe, defaultContext);

    const warning = result.findings.find(
      (f) => f.title.includes('local') && f.title.includes('90%'),
    );
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('failed tasks in last 24h — warning per task', async () => {
    const now = Math.floor(Date.now() / 1000);
    const recentFailedTasks = {
      tasks: [
        {
          type: 'qmstart',
          status: 'ERROR: failed',
          node: 'pve01',
          starttime: now - 3600,
          endtime: now - 3500,
        },
      ],
      warnings: [],
    };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.status': { data: healthyClusterStatus },
      'proxmox.nodes.list': { data: healthyNodesList },
      'proxmox.cluster.ha.status': { data: { resources: [], warnings: [] } },
      'proxmox.cluster.tasks': { data: recentFailedTasks },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({}, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('Failed task'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('per-node storage iteration — probes run for each node', async () => {
    const calls: string[] = [];
    const runProbe: RunProbe = async (probe, params) => {
      const key = params?.node ? `${probe}:${params.node}` : probe;
      calls.push(key);
      const responses: Record<string, unknown> = {
        'proxmox.cluster.status': healthyClusterStatus,
        'proxmox.nodes.list': healthyNodesList,
        'proxmox.cluster.ha.status': { resources: [], warnings: [] },
        'proxmox.cluster.tasks': emptyTasks,
        'proxmox.node.storage': healthyNodeStorage,
      };
      return mockResult(probe, responses[probe]);
    };

    await handler({}, runProbe, defaultContext);

    // Should have storage calls for both pve01 and pve02
    expect(calls.filter((c) => c.startsWith('proxmox.node.storage'))).toHaveLength(2);
  });
});

// =============================================================================
// proxmox-storage-audit tests
// =============================================================================

describe('proxmox-storage-audit', () => {
  const handler = getHandler('proxmox-storage');

  it('no HA VMs — info finding', async () => {
    const noHa = { resources: [], warnings: [] };
    const resources = {
      resources: [{ vmid: 100, name: 'web-01', node: 'pve01', type: 'qemu', status: 'running' }],
    };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.resources': { data: resources },
      'proxmox.cluster.ha.status': { data: noHa },
    });

    const result = await handler({}, runProbe, defaultContext);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('info');
    expect(result.findings[0]?.title).toContain('No HA-managed VMs');
    expect(result.summary.summaryText).toContain('0 HA-managed VMs');
  });

  it('all shared storage — info finding', async () => {
    const resources = {
      resources: [{ vmid: 100, name: 'web-01', node: 'pve01', type: 'qemu', status: 'running' }],
    };
    const haStatus = {
      resources: [{ sid: 'vm:100', state: 'started', node: 'pve01' }],
      warnings: [],
    };
    const sharedConfig = {
      vmid: 100,
      node: 'pve01',
      config: {},
      disks: [{ key: 'scsi0', storage: 'ceph-pool', format: 'raw', size: '32G' }],
      warnings: [],
    };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.resources': { data: resources },
      'proxmox.cluster.ha.status': { data: haStatus },
      'proxmox.vm.config': { data: sharedConfig },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({}, runProbe, defaultContext);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('info');
    expect(result.findings[0]?.title).toContain('shared storage');
  });

  it('local storage on HA QEMU VM — critical with qm move-disk', async () => {
    const resources = {
      resources: [{ vmid: 100, name: 'web-01', node: 'pve01', type: 'qemu', status: 'running' }],
    };
    const haStatus = {
      resources: [{ sid: 'vm:100', state: 'started', node: 'pve01' }],
      warnings: [],
    };
    const localConfig = {
      vmid: 100,
      node: 'pve01',
      config: {},
      disks: [{ key: 'scsi0', storage: 'local-lvm', format: 'raw', size: '32G' }],
      warnings: [],
    };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.resources': { data: resources },
      'proxmox.cluster.ha.status': { data: haStatus },
      'proxmox.vm.config': { data: localConfig },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({}, runProbe, defaultContext);

    const critical = result.findings.find((f) => f.severity === 'critical');
    expect(critical).toBeDefined();
    expect(critical?.title).toContain('local storage');
    expect(critical?.remediation).toContain('qm move-disk 100 scsi0 ceph-pool --delete');
  });

  it('local storage on HA LXC container — critical (checks rootfs)', async () => {
    const resources = {
      resources: [{ vmid: 200, name: 'ct-db', node: 'pve01', type: 'lxc', status: 'running' }],
    };
    const haStatus = {
      resources: [{ sid: 'ct:200', state: 'started', node: 'pve01' }],
      warnings: [],
    };
    const lxcConfig = {
      vmid: 200,
      node: 'pve01',
      config: {},
      rootfs: { storage: 'local-lvm', size: '8G' },
      mountpoints: [{ key: 'mp0', storage: 'local-lvm', mountpoint: '/data', size: '20G' }],
      warnings: [],
    };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.resources': { data: resources },
      'proxmox.cluster.ha.status': { data: haStatus },
      'proxmox.lxc.config': { data: lxcConfig },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({}, runProbe, defaultContext);

    const criticals = result.findings.filter((f) => f.severity === 'critical');
    // Should flag both rootfs and mp0
    expect(criticals.length).toBeGreaterThanOrEqual(2);
    expect(criticals.some((f) => f.title.includes('rootfs'))).toBe(true);
    expect(criticals.some((f) => f.title.includes('mp0'))).toBe(true);
  });

  it('mixed — only flags local ones', async () => {
    const resources = {
      resources: [
        { vmid: 100, name: 'shared-vm', node: 'pve01', type: 'qemu', status: 'running' },
        { vmid: 101, name: 'local-vm', node: 'pve01', type: 'qemu', status: 'running' },
      ],
    };
    const haStatus = {
      resources: [
        { sid: 'vm:100', state: 'started', node: 'pve01' },
        { sid: 'vm:101', state: 'started', node: 'pve01' },
      ],
      warnings: [],
    };

    const calls: Array<{ probe: string; params?: Record<string, unknown> }> = [];
    const runProbe: RunProbe = async (probe, params) => {
      calls.push({ probe, params });
      if (probe === 'proxmox.cluster.resources') return mockResult(probe, resources);
      if (probe === 'proxmox.cluster.ha.status') return mockResult(probe, haStatus);
      if (probe === 'proxmox.node.storage') return mockResult(probe, healthyNodeStorage);
      if (probe === 'proxmox.vm.config') {
        const vmid = params?.vmid as number;
        if (vmid === 100) {
          return mockResult(probe, {
            disks: [{ key: 'scsi0', storage: 'ceph-pool', format: 'raw', size: '32G' }],
          });
        }
        return mockResult(probe, {
          disks: [{ key: 'scsi0', storage: 'local-lvm', format: 'raw', size: '32G' }],
        });
      }
      return mockResult(probe, undefined, 'error', 'Unknown probe');
    };

    const result = await handler({}, runProbe, defaultContext);

    const criticals = result.findings.filter((f) => f.severity === 'critical');
    expect(criticals).toHaveLength(1);
    expect(criticals[0]?.title).toContain('101');
  });

  it('suggests shared storage name from available storages', async () => {
    const resources = {
      resources: [{ vmid: 100, name: 'web-01', node: 'pve01', type: 'qemu', status: 'running' }],
    };
    const haStatus = {
      resources: [{ sid: 'vm:100', state: 'started', node: 'pve01' }],
      warnings: [],
    };
    const localConfig = {
      disks: [{ key: 'scsi0', storage: 'local-lvm', format: 'raw', size: '32G' }],
    };

    const runProbe = createMockRunProbe({
      'proxmox.cluster.resources': { data: resources },
      'proxmox.cluster.ha.status': { data: haStatus },
      'proxmox.vm.config': { data: localConfig },
      'proxmox.node.storage': { data: healthyNodeStorage },
    });

    const result = await handler({}, runProbe, defaultContext);

    const critical = result.findings.find((f) => f.severity === 'critical');
    expect(critical?.remediation).toContain('ceph-pool');
  });
});

// =============================================================================
// Definitions
// =============================================================================

describe('proxmoxDiagnosticRunbooks definitions', () => {
  it('exports 3 runbook definitions', () => {
    expect(proxmoxDiagnosticRunbooks).toHaveLength(3);
  });

  it('has correct categories', () => {
    const categories = proxmoxDiagnosticRunbooks.map((r) => r.category);
    expect(categories).toContain('proxmox-vm');
    expect(categories).toContain('proxmox-cluster');
    expect(categories).toContain('proxmox-storage');
  });

  it('proxmox-vm requires vmid param', () => {
    const def = proxmoxDiagnosticRunbooks.find((r) => r.category === 'proxmox-vm');
    expect(def?.params?.vmid?.required).toBe(true);
  });

  it('proxmox-storage has no required params', () => {
    const def = proxmoxDiagnosticRunbooks.find((r) => r.category === 'proxmox-storage');
    expect(def?.params).toBeUndefined();
  });
});
