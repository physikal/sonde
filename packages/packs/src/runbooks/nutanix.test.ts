import { describe, expect, it } from 'vitest';
import type { RunProbe, RunbookContext, RunbookProbeResult } from '../types.js';
import { nutanixDiagnosticRunbooks } from './nutanix.js';

// --- Test helpers ---

function getHandler(category: string) {
  const def = nutanixDiagnosticRunbooks.find((r) => r.category === category);
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

function createMockRunProbe(
  responses: Record<
    string,
    { data?: unknown; status?: 'success' | 'error' | 'timeout'; error?: string }
  >,
): RunProbe {
  return async (probe: string, _params?: Record<string, unknown>, _agent?: string) => {
    const response = responses[probe];
    if (!response) {
      return mockResult(probe, undefined, 'error', `No mock for probe ${probe}`);
    }
    return mockResult(probe, response.data, response.status ?? 'success', response.error);
  };
}

const defaultContext: RunbookContext = { connectedAgents: [] };

// --- Fixtures ---

const healthyClusters = {
  clusters: [
    { name: 'prod-01', extId: 'c-001', operationMode: 'NORMAL', isDegraded: false, numNodes: 4 },
    { name: 'prod-02', extId: 'c-002', operationMode: 'NORMAL', isDegraded: false, numNodes: 3 },
  ],
  totalCount: 2,
};

const healthyHosts = {
  hosts: [
    { name: 'host-01', extId: 'h-001', maintenanceMode: false },
    { name: 'host-02', extId: 'h-002', maintenanceMode: false },
    { name: 'host-03', extId: 'h-003', maintenanceMode: false },
  ],
  totalCount: 3,
};

const healthyAlertsSummary = {
  bySeverity: { CRITICAL: 0, WARNING: 2, INFO: 5 },
  byEntityType: { vm: 5, host: 2 },
  unresolvedCritical: [],
  totalCount: 7,
};

const healthyStorage = {
  containers: [
    {
      name: 'default-container',
      usedPct: 45,
      highUsage: false,
      maxCapacityBytes: 1e12,
      usedBytes: 4.5e11,
      availableBytes: 5.5e11,
    },
    {
      name: 'ssd-tier',
      usedPct: 60,
      highUsage: false,
      maxCapacityBytes: 5e11,
      usedBytes: 3e11,
      availableBytes: 2e11,
    },
  ],
  totalCount: 2,
};

const healthyTasks = {
  tasks: [
    {
      type: 'VmCreate',
      status: 'SUCCEEDED',
      isFailed: false,
      isLongRunning: false,
      startTime: '2026-02-17T10:00:00Z',
    },
  ],
  totalCount: 1,
};

const healthyLifecycle = {
  entities: [],
  updatableCount: 0,
  totalCount: 0,
  warnings: [],
};

const healthyVmDetail = {
  name: 'web-01',
  extId: 'vm-001',
  powerState: 'ON',
  numSockets: 4,
  numCoresPerSocket: 2,
  memorySizeMb: 8192,
  clusterExtId: 'c-001',
  hostExtId: 'h-001',
  guestTools: { isEnabled: true },
  categories: null,
};

const healthyVmStats = {
  cpuUsagePct: 35,
  memoryUsagePct: 55,
  iops: 200,
  avgIoLatencyMs: 5,
  ioBandwidthKbps: 50000,
  networkRxBytes: 1000000,
  networkTxBytes: 500000,
};

const healthySnapshots = {
  snapshots: [{ name: 'daily-snap', ageDays: 1, isOld: false, isExpired: false }],
  totalCount: 1,
  usedV3: false,
  warnings: [],
};

const healthyProtection = {
  policies: [{ name: 'gold-policy', extId: 'pp-001' }],
  totalCount: 1,
  vmCovered: true,
  allPoliciesCount: 3,
};

const emptyAlerts = { alerts: [], totalCount: 0 };

// =============================================================================
// nutanix-cluster-health tests
// =============================================================================

describe('nutanix-cluster-health', () => {
  const handler = getHandler('nutanix-cluster-health');

  it('healthy environment — no issues', async () => {
    const runProbe = createMockRunProbe({
      'nutanix.clusters.list': { data: healthyClusters },
      'nutanix.alerts.summary': { data: healthyAlertsSummary },
      'nutanix.storage.containers': { data: healthyStorage },
      'nutanix.tasks.recent': { data: healthyTasks },
      'nutanix.lifecycle.status': { data: healthyLifecycle },
      'nutanix.hosts.list': { data: healthyHosts },
    });

    const result = await handler({}, runProbe, defaultContext);

    expect(result.category).toBe('nutanix-cluster-health');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('info');
    expect(result.findings[0]?.title).toContain('healthy');
    expect(result.summary.probesRun).toBe(6);
  });

  it('degraded cluster — critical finding', async () => {
    const degraded = {
      clusters: [
        {
          name: 'prod-01',
          extId: 'c-001',
          operationMode: 'READ_ONLY',
          isDegraded: true,
          numNodes: 4,
        },
      ],
      totalCount: 1,
    };

    const runProbe = createMockRunProbe({
      'nutanix.clusters.list': { data: degraded },
      'nutanix.alerts.summary': { data: healthyAlertsSummary },
      'nutanix.storage.containers': { data: healthyStorage },
      'nutanix.tasks.recent': { data: healthyTasks },
      'nutanix.lifecycle.status': { data: healthyLifecycle },
      'nutanix.hosts.list': { data: healthyHosts },
    });

    const result = await handler({}, runProbe, defaultContext);

    const critical = result.findings.find((f) => f.title.includes('degraded'));
    expect(critical).toBeDefined();
    expect(critical?.severity).toBe('critical');
    expect(critical?.detail).toContain('READ_ONLY');
  });

  it('hosts in maintenance — warning', async () => {
    const maintenanceHosts = {
      hosts: [
        { name: 'host-01', extId: 'h-001', maintenanceMode: true },
        { name: 'host-02', extId: 'h-002', maintenanceMode: false },
      ],
      totalCount: 2,
    };

    const runProbe = createMockRunProbe({
      'nutanix.clusters.list': { data: healthyClusters },
      'nutanix.alerts.summary': { data: healthyAlertsSummary },
      'nutanix.storage.containers': { data: healthyStorage },
      'nutanix.tasks.recent': { data: healthyTasks },
      'nutanix.lifecycle.status': { data: healthyLifecycle },
      'nutanix.hosts.list': { data: maintenanceHosts },
    });

    const result = await handler({}, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('maintenance'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
    expect(warning?.detail).toContain('host-01');
  });

  it('unresolved critical alerts — critical findings', async () => {
    const criticalAlerts = {
      bySeverity: { CRITICAL: 2, WARNING: 0, INFO: 0 },
      byEntityType: { vm: 2 },
      unresolvedCritical: [
        {
          title: 'Disk failure on host-01',
          sourceEntity: { type: 'host', name: 'host-01' },
          creationTime: '2026-02-17T08:00:00Z',
        },
        {
          title: 'Memory threshold exceeded',
          sourceEntity: { type: 'vm', name: 'web-01' },
          creationTime: '2026-02-17T09:00:00Z',
        },
      ],
      totalCount: 2,
    };

    const runProbe = createMockRunProbe({
      'nutanix.clusters.list': { data: healthyClusters },
      'nutanix.alerts.summary': { data: criticalAlerts },
      'nutanix.storage.containers': { data: healthyStorage },
      'nutanix.tasks.recent': { data: healthyTasks },
      'nutanix.lifecycle.status': { data: healthyLifecycle },
      'nutanix.hosts.list': { data: healthyHosts },
    });

    const result = await handler({}, runProbe, defaultContext);

    const criticals = result.findings.filter((f) => f.severity === 'critical');
    expect(criticals.length).toBe(2);
    expect(criticals[0]?.title).toContain('Disk failure');
  });

  it('storage >85% — warning', async () => {
    const fullStorage = {
      containers: [
        {
          name: 'full-container',
          usedPct: 92,
          highUsage: true,
          maxCapacityBytes: 1e12,
          usedBytes: 9.2e11,
          availableBytes: 8e10,
        },
      ],
      totalCount: 1,
    };

    const runProbe = createMockRunProbe({
      'nutanix.clusters.list': { data: healthyClusters },
      'nutanix.alerts.summary': { data: healthyAlertsSummary },
      'nutanix.storage.containers': { data: fullStorage },
      'nutanix.tasks.recent': { data: healthyTasks },
      'nutanix.lifecycle.status': { data: healthyLifecycle },
      'nutanix.hosts.list': { data: healthyHosts },
    });

    const result = await handler({}, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('full-container'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
    expect(warning?.title).toContain('92%');
  });

  it('failed tasks — warning', async () => {
    const failedTasks = {
      tasks: [
        {
          type: 'VmMigrate',
          status: 'FAILED',
          isFailed: true,
          isLongRunning: false,
          errorMessage: 'Insufficient resources',
          startTime: '2026-02-17T10:00:00Z',
        },
      ],
      totalCount: 1,
    };

    const runProbe = createMockRunProbe({
      'nutanix.clusters.list': { data: healthyClusters },
      'nutanix.alerts.summary': { data: healthyAlertsSummary },
      'nutanix.storage.containers': { data: healthyStorage },
      'nutanix.tasks.recent': { data: failedTasks },
      'nutanix.lifecycle.status': { data: healthyLifecycle },
      'nutanix.hosts.list': { data: healthyHosts },
    });

    const result = await handler({}, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('failed task'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('long-running tasks — warning', async () => {
    const longRunningTasks = {
      tasks: [
        {
          type: 'ClusterUpgrade',
          status: 'RUNNING',
          isFailed: false,
          isLongRunning: true,
          startTime: '2026-02-17T06:00:00Z',
        },
      ],
      totalCount: 1,
    };

    const runProbe = createMockRunProbe({
      'nutanix.clusters.list': { data: healthyClusters },
      'nutanix.alerts.summary': { data: healthyAlertsSummary },
      'nutanix.storage.containers': { data: healthyStorage },
      'nutanix.tasks.recent': { data: longRunningTasks },
      'nutanix.lifecycle.status': { data: healthyLifecycle },
      'nutanix.hosts.list': { data: healthyHosts },
    });

    const result = await handler({}, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('long-running'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('LCM updates available — info finding', async () => {
    const updatesAvailable = {
      entities: [
        { entityType: 'AOS', currentVersion: '6.5.1', availableVersion: '6.6.0', hasUpdate: true },
      ],
      updatableCount: 1,
      totalCount: 1,
      warnings: ['1 component(s) have available updates', 'AOS: 6.5.1 \u2192 6.6.0'],
    };

    const runProbe = createMockRunProbe({
      'nutanix.clusters.list': { data: healthyClusters },
      'nutanix.alerts.summary': { data: healthyAlertsSummary },
      'nutanix.storage.containers': { data: healthyStorage },
      'nutanix.tasks.recent': { data: healthyTasks },
      'nutanix.lifecycle.status': { data: updatesAvailable },
      'nutanix.hosts.list': { data: healthyHosts },
    });

    const result = await handler({}, runProbe, defaultContext);

    const info = result.findings.find((f) => f.title.includes('update'));
    expect(info).toBeDefined();
    expect(info?.severity).toBe('info');
  });
});

// =============================================================================
// nutanix-vm-health tests
// =============================================================================

describe('nutanix-vm-health', () => {
  const handler = getHandler('nutanix-vm-health');

  it('healthy VM by ID — all probes good', async () => {
    const runProbe = createMockRunProbe({
      'nutanix.vm.detail': { data: healthyVmDetail },
      'nutanix.vm.stats': { data: healthyVmStats },
      'nutanix.vm.snapshots': { data: healthySnapshots },
      'nutanix.alerts.list': { data: emptyAlerts },
      'nutanix.protection.policies': { data: healthyProtection },
    });

    const result = await handler({ vm_id: 'vm-001' }, runProbe, defaultContext);

    expect(result.category).toBe('nutanix-vm-health');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('info');
    expect(result.findings[0]?.title).toContain('healthy');
    expect(result.summary.probesRun).toBe(5);
  });

  it('resolve vm_name to vm_id', async () => {
    const calls: Array<{ probe: string; params?: Record<string, unknown> }> = [];
    const runProbe: RunProbe = async (probe, params) => {
      calls.push({ probe, params });
      const responses: Record<string, unknown> = {
        'nutanix.vms.list': { vms: [{ name: 'web-01', extId: 'vm-001' }] },
        'nutanix.vm.detail': healthyVmDetail,
        'nutanix.vm.stats': healthyVmStats,
        'nutanix.vm.snapshots': healthySnapshots,
        'nutanix.alerts.list': emptyAlerts,
        'nutanix.protection.policies': healthyProtection,
      };
      return mockResult(probe, responses[probe]);
    };

    const result = await handler({ vm_name: 'web-01' }, runProbe, defaultContext);

    expect(calls[0]?.probe).toBe('nutanix.vms.list');
    expect(calls[0]?.params?.name).toBe('web-01');
    expect(result.findings.some((f) => f.severity === 'info')).toBe(true);
  });

  it('VM not found by name — critical', async () => {
    const runProbe = createMockRunProbe({
      'nutanix.vms.list': { data: { vms: [], totalCount: 0 } },
    });

    const result = await handler({ vm_name: 'nonexistent' }, runProbe, defaultContext);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('critical');
    expect(result.findings[0]?.title).toContain('not found');
  });

  it('no VM specified — critical', async () => {
    const runProbe = createMockRunProbe({});
    const result = await handler({}, runProbe, defaultContext);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('critical');
    expect(result.findings[0]?.title).toContain('No VM specified');
  });

  it('VM powered off — warning', async () => {
    const offVm = { ...healthyVmDetail, powerState: 'OFF' };

    const runProbe = createMockRunProbe({
      'nutanix.vm.detail': { data: offVm },
      'nutanix.vm.stats': { data: healthyVmStats },
      'nutanix.vm.snapshots': { data: healthySnapshots },
      'nutanix.alerts.list': { data: emptyAlerts },
      'nutanix.protection.policies': { data: healthyProtection },
    });

    const result = await handler({ vm_id: 'vm-001' }, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('powered off'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('high CPU — warning', async () => {
    const highCpu = { ...healthyVmStats, cpuUsagePct: 92 };

    const runProbe = createMockRunProbe({
      'nutanix.vm.detail': { data: healthyVmDetail },
      'nutanix.vm.stats': { data: highCpu },
      'nutanix.vm.snapshots': { data: healthySnapshots },
      'nutanix.alerts.list': { data: emptyAlerts },
      'nutanix.protection.policies': { data: healthyProtection },
    });

    const result = await handler({ vm_id: 'vm-001' }, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('CPU'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
    expect(warning?.title).toContain('92%');
  });

  it('high memory — warning', async () => {
    const highMem = { ...healthyVmStats, memoryUsagePct: 95 };

    const runProbe = createMockRunProbe({
      'nutanix.vm.detail': { data: healthyVmDetail },
      'nutanix.vm.stats': { data: highMem },
      'nutanix.vm.snapshots': { data: healthySnapshots },
      'nutanix.alerts.list': { data: emptyAlerts },
      'nutanix.protection.policies': { data: healthyProtection },
    });

    const result = await handler({ vm_id: 'vm-001' }, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('memory'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('high I/O latency — warning', async () => {
    const highLatency = { ...healthyVmStats, avgIoLatencyMs: 45 };

    const runProbe = createMockRunProbe({
      'nutanix.vm.detail': { data: healthyVmDetail },
      'nutanix.vm.stats': { data: highLatency },
      'nutanix.vm.snapshots': { data: healthySnapshots },
      'nutanix.alerts.list': { data: emptyAlerts },
      'nutanix.protection.policies': { data: healthyProtection },
    });

    const result = await handler({ vm_id: 'vm-001' }, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('I/O latency'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
    expect(warning?.title).toContain('45ms');
  });

  it('no data protection — warning with remediation', async () => {
    const noProtection = { policies: [], totalCount: 0, vmCovered: false, allPoliciesCount: 3 };

    const runProbe = createMockRunProbe({
      'nutanix.vm.detail': { data: healthyVmDetail },
      'nutanix.vm.stats': { data: healthyVmStats },
      'nutanix.vm.snapshots': { data: healthySnapshots },
      'nutanix.alerts.list': { data: emptyAlerts },
      'nutanix.protection.policies': { data: noProtection },
    });

    const result = await handler({ vm_id: 'vm-001' }, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('no data protection'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
    expect(warning?.remediation).toContain('protection policy');
  });

  it('old snapshots — info finding', async () => {
    const oldSnaps = {
      snapshots: [
        { name: 'old-snap', ageDays: 14, isOld: true, isExpired: false },
        { name: 'very-old-snap', ageDays: 30, isOld: true, isExpired: false },
      ],
      totalCount: 2,
      warnings: ['2 snapshot(s) older than 7 days'],
    };

    const runProbe = createMockRunProbe({
      'nutanix.vm.detail': { data: healthyVmDetail },
      'nutanix.vm.stats': { data: healthyVmStats },
      'nutanix.vm.snapshots': { data: oldSnaps },
      'nutanix.alerts.list': { data: emptyAlerts },
      'nutanix.protection.policies': { data: healthyProtection },
    });

    const result = await handler({ vm_id: 'vm-001' }, runProbe, defaultContext);

    const info = result.findings.find((f) => f.title.includes('older than 7 days'));
    expect(info).toBeDefined();
    expect(info?.severity).toBe('info');
  });

  it('expired snapshots — warning', async () => {
    const expiredSnaps = {
      snapshots: [{ name: 'expired-snap', ageDays: 10, isOld: true, isExpired: true }],
      totalCount: 1,
      warnings: [],
    };

    const runProbe = createMockRunProbe({
      'nutanix.vm.detail': { data: healthyVmDetail },
      'nutanix.vm.stats': { data: healthyVmStats },
      'nutanix.vm.snapshots': { data: expiredSnaps },
      'nutanix.alerts.list': { data: emptyAlerts },
      'nutanix.protection.policies': { data: healthyProtection },
    });

    const result = await handler({ vm_id: 'vm-001' }, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('expired'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('guest tools not installed — info', async () => {
    const noGt = { ...healthyVmDetail, guestTools: { isEnabled: false } };

    const runProbe = createMockRunProbe({
      'nutanix.vm.detail': { data: noGt },
      'nutanix.vm.stats': { data: healthyVmStats },
      'nutanix.vm.snapshots': { data: healthySnapshots },
      'nutanix.alerts.list': { data: emptyAlerts },
      'nutanix.protection.policies': { data: healthyProtection },
    });

    const result = await handler({ vm_id: 'vm-001' }, runProbe, defaultContext);

    const info = result.findings.find((f) => f.title.includes('Guest tools'));
    expect(info).toBeDefined();
    expect(info?.severity).toBe('info');
  });

  it('VM-related alerts — reported as findings', async () => {
    const vmAlerts = {
      alerts: [
        {
          title: 'VM memory pressure',
          severity: 'CRITICAL',
          sourceEntity: { type: 'vm', name: 'web-01', extId: 'vm-001' },
          creationTime: '2026-02-17T10:00:00Z',
        },
      ],
      totalCount: 1,
    };

    const runProbe = createMockRunProbe({
      'nutanix.vm.detail': { data: healthyVmDetail },
      'nutanix.vm.stats': { data: healthyVmStats },
      'nutanix.vm.snapshots': { data: healthySnapshots },
      'nutanix.alerts.list': { data: vmAlerts },
      'nutanix.protection.policies': { data: healthyProtection },
    });

    const result = await handler({ vm_id: 'vm-001' }, runProbe, defaultContext);

    const alert = result.findings.find((f) => f.title.includes('VM memory pressure'));
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe('critical');
  });

  it('VM unreachable — critical with early return', async () => {
    const runProbe = createMockRunProbe({
      'nutanix.vm.detail': { status: 'error', error: 'Connection refused' },
      'nutanix.vm.stats': { data: null },
      'nutanix.vm.snapshots': { data: null },
      'nutanix.alerts.list': { data: emptyAlerts },
      'nutanix.protection.policies': { data: null },
    });

    const result = await handler({ vm_id: 'vm-001' }, runProbe, defaultContext);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('critical');
    expect(result.findings[0]?.title).toContain('unreachable');
  });
});

// =============================================================================
// nutanix-capacity-planning tests
// =============================================================================

describe('nutanix-capacity-planning', () => {
  const handler = getHandler('nutanix-capacity-planning');

  const healthyClusterStats = {
    cpuCapacityHz: 1e12,
    cpuUsedHz: 3e11,
    cpuUsagePct: 30,
    memoryCapacityBytes: 1e12,
    memoryUsedBytes: 4e11,
    memoryUsagePct: 40,
    storageCapacityBytes: 5e12,
    storageUsedBytes: 1.5e12,
    storageUsagePct: 30,
    iops: 5000,
    avgIoLatencyMs: 3,
  };

  const healthyVmsList = {
    vms: Array.from({ length: 10 }, (_, i) => ({
      name: `vm-${i}`,
      extId: `vm-${i}`,
      powerState: 'ON',
    })),
    totalCount: 10,
  };

  it('healthy capacity — no issues', async () => {
    const runProbe: RunProbe = async (probe, params) => {
      if (probe === 'nutanix.clusters.list')
        return mockResult(probe, {
          clusters: [{ name: 'prod', extId: 'c-001', isDegraded: false }],
        });
      if (probe === 'nutanix.cluster.stats') return mockResult(probe, healthyClusterStats);
      if (probe === 'nutanix.storage.containers') return mockResult(probe, healthyStorage);
      if (probe === 'nutanix.hosts.list') return mockResult(probe, healthyHosts);
      if (probe === 'nutanix.vms.list') return mockResult(probe, healthyVmsList);
      return mockResult(probe, undefined, 'error');
    };

    const result = await handler({}, runProbe, defaultContext);

    expect(result.category).toBe('nutanix-capacity-planning');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('info');
    expect(result.findings[0]?.title).toContain('healthy thresholds');
  });

  it('high CPU utilization >80% — warning', async () => {
    const highCpuStats = { ...healthyClusterStats, cpuUsagePct: 85 };

    const runProbe: RunProbe = async (probe) => {
      if (probe === 'nutanix.clusters.list')
        return mockResult(probe, {
          clusters: [{ name: 'prod', extId: 'c-001', isDegraded: false }],
        });
      if (probe === 'nutanix.cluster.stats') return mockResult(probe, highCpuStats);
      if (probe === 'nutanix.storage.containers') return mockResult(probe, healthyStorage);
      if (probe === 'nutanix.hosts.list') return mockResult(probe, healthyHosts);
      if (probe === 'nutanix.vms.list') return mockResult(probe, healthyVmsList);
      return mockResult(probe, undefined, 'error');
    };

    const result = await handler({}, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('CPU'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
    expect(warning?.title).toContain('85%');
  });

  it('critical CPU >90% — critical', async () => {
    const criticalCpuStats = { ...healthyClusterStats, cpuUsagePct: 95 };

    const runProbe: RunProbe = async (probe) => {
      if (probe === 'nutanix.clusters.list')
        return mockResult(probe, {
          clusters: [{ name: 'prod', extId: 'c-001', isDegraded: false }],
        });
      if (probe === 'nutanix.cluster.stats') return mockResult(probe, criticalCpuStats);
      if (probe === 'nutanix.storage.containers') return mockResult(probe, healthyStorage);
      if (probe === 'nutanix.hosts.list') return mockResult(probe, healthyHosts);
      if (probe === 'nutanix.vms.list') return mockResult(probe, healthyVmsList);
      return mockResult(probe, undefined, 'error');
    };

    const result = await handler({}, runProbe, defaultContext);

    const critical = result.findings.find((f) => f.title.includes('CPU'));
    expect(critical).toBeDefined();
    expect(critical?.severity).toBe('critical');
  });

  it('high memory >80% — warning', async () => {
    const highMemStats = { ...healthyClusterStats, memoryUsagePct: 88 };

    const runProbe: RunProbe = async (probe) => {
      if (probe === 'nutanix.clusters.list')
        return mockResult(probe, {
          clusters: [{ name: 'prod', extId: 'c-001', isDegraded: false }],
        });
      if (probe === 'nutanix.cluster.stats') return mockResult(probe, highMemStats);
      if (probe === 'nutanix.storage.containers') return mockResult(probe, healthyStorage);
      if (probe === 'nutanix.hosts.list') return mockResult(probe, healthyHosts);
      if (probe === 'nutanix.vms.list') return mockResult(probe, healthyVmsList);
      return mockResult(probe, undefined, 'error');
    };

    const result = await handler({}, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('memory'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('high storage >80% — warning', async () => {
    const highStorageStats = { ...healthyClusterStats, storageUsagePct: 87 };

    const runProbe: RunProbe = async (probe) => {
      if (probe === 'nutanix.clusters.list')
        return mockResult(probe, {
          clusters: [{ name: 'prod', extId: 'c-001', isDegraded: false }],
        });
      if (probe === 'nutanix.cluster.stats') return mockResult(probe, highStorageStats);
      if (probe === 'nutanix.storage.containers') return mockResult(probe, healthyStorage);
      if (probe === 'nutanix.hosts.list') return mockResult(probe, healthyHosts);
      if (probe === 'nutanix.vms.list') return mockResult(probe, healthyVmsList);
      return mockResult(probe, undefined, 'error');
    };

    const result = await handler({}, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('storage'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('high VM density >30/host — warning', async () => {
    const singleHost = { hosts: [{ name: 'host-01', extId: 'h-001' }], totalCount: 1 };
    const manyVms = {
      vms: Array.from({ length: 35 }, (_, i) => ({ name: `vm-${i}` })),
      totalCount: 35,
    };

    const runProbe: RunProbe = async (probe) => {
      if (probe === 'nutanix.clusters.list')
        return mockResult(probe, {
          clusters: [{ name: 'prod', extId: 'c-001', isDegraded: false }],
        });
      if (probe === 'nutanix.cluster.stats') return mockResult(probe, healthyClusterStats);
      if (probe === 'nutanix.storage.containers') return mockResult(probe, healthyStorage);
      if (probe === 'nutanix.hosts.list') return mockResult(probe, singleHost);
      if (probe === 'nutanix.vms.list') return mockResult(probe, manyVms);
      return mockResult(probe, undefined, 'error');
    };

    const result = await handler({}, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('VM density'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
    expect(warning?.detail).toContain('35');
  });

  it('no clusters — critical with early return', async () => {
    const runProbe = createMockRunProbe({
      'nutanix.clusters.list': { status: 'error', error: 'Connection refused' },
    });

    const result = await handler({}, runProbe, defaultContext);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('critical');
    expect(result.findings[0]?.title).toContain('No clusters');
  });

  it('per-container >85% — warning', async () => {
    const fullContainers = {
      containers: [{ name: 'hot-container', usedPct: 91, highUsage: true }],
      totalCount: 1,
    };

    const runProbe: RunProbe = async (probe) => {
      if (probe === 'nutanix.clusters.list')
        return mockResult(probe, {
          clusters: [{ name: 'prod', extId: 'c-001', isDegraded: false }],
        });
      if (probe === 'nutanix.cluster.stats') return mockResult(probe, healthyClusterStats);
      if (probe === 'nutanix.storage.containers') return mockResult(probe, fullContainers);
      if (probe === 'nutanix.hosts.list') return mockResult(probe, healthyHosts);
      if (probe === 'nutanix.vms.list') return mockResult(probe, healthyVmsList);
      return mockResult(probe, undefined, 'error');
    };

    const result = await handler({}, runProbe, defaultContext);

    const warning = result.findings.find((f) => f.title.includes('hot-container'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('multi-cluster — probes run per cluster', async () => {
    const calls: string[] = [];
    const runProbe: RunProbe = async (probe, params) => {
      calls.push(probe);
      if (probe === 'nutanix.clusters.list') {
        return mockResult(probe, {
          clusters: [
            { name: 'dc1', extId: 'c-001', isDegraded: false },
            { name: 'dc2', extId: 'c-002', isDegraded: false },
          ],
        });
      }
      if (probe === 'nutanix.cluster.stats') return mockResult(probe, healthyClusterStats);
      if (probe === 'nutanix.storage.containers') return mockResult(probe, healthyStorage);
      if (probe === 'nutanix.hosts.list') return mockResult(probe, healthyHosts);
      if (probe === 'nutanix.vms.list') return mockResult(probe, healthyVmsList);
      return mockResult(probe, undefined, 'error');
    };

    const result = await handler({}, runProbe, defaultContext);

    // Should have 2x cluster.stats calls (one per cluster)
    expect(calls.filter((c) => c === 'nutanix.cluster.stats')).toHaveLength(2);
    expect(result.summary.summaryText).toContain('2 cluster(s)');
  });
});

// =============================================================================
// nutanix-storefront-investigate tests
// =============================================================================

describe('nutanix-storefront-investigate', () => {
  const handler = getHandler('nutanix-storefront-investigate');

  it('healthy tagged VMs — no issues', async () => {
    const entities = {
      entities: [
        { entityType: 'vm', entityId: 'vm-001', entityName: 'storefront-01' },
        { entityType: 'vm', entityId: 'vm-002', entityName: 'storefront-02' },
      ],
      totalCount: 2,
    };

    const runProbe: RunProbe = async (probe, params) => {
      if (probe === 'nutanix.categories.entities') return mockResult(probe, entities);
      if (probe === 'nutanix.vm.detail')
        return mockResult(probe, {
          ...healthyVmDetail,
          name: params?.vm_id === 'vm-001' ? 'storefront-01' : 'storefront-02',
        });
      if (probe === 'nutanix.vm.stats') return mockResult(probe, healthyVmStats);
      if (probe === 'nutanix.alerts.list') return mockResult(probe, emptyAlerts);
      return mockResult(probe, undefined, 'error');
    };

    const result = await handler(
      { category_key: 'Environment', category_value: 'Storefront' },
      runProbe,
      defaultContext,
    );

    expect(result.category).toBe('nutanix-storefront-investigate');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('info');
    expect(result.findings[0]?.title).toContain('healthy');
  });

  it('missing category params — critical', async () => {
    const runProbe = createMockRunProbe({});
    const result = await handler({}, runProbe, defaultContext);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('critical');
    expect(result.findings[0]?.title).toContain('Missing category');
  });

  it('no entities found — info', async () => {
    const runProbe = createMockRunProbe({
      'nutanix.categories.entities': { data: { entities: [], totalCount: 0 } },
    });

    const result = await handler(
      { category_key: 'App', category_value: 'None' },
      runProbe,
      defaultContext,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('info');
    expect(result.findings[0]?.title).toContain('No entities');
  });

  it('non-VM entities only — info', async () => {
    const entities = {
      entities: [{ entityType: 'host', entityId: 'h-001', entityName: 'host-01' }],
      totalCount: 1,
    };

    const runProbe = createMockRunProbe({
      'nutanix.categories.entities': { data: entities },
    });

    const result = await handler(
      { category_key: 'Tier', category_value: 'Gold' },
      runProbe,
      defaultContext,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toContain('no VMs');
  });

  it('powered off VMs — warning per VM', async () => {
    const entities = {
      entities: [
        { entityType: 'vm', entityId: 'vm-001', entityName: 'store-01' },
        { entityType: 'vm', entityId: 'vm-002', entityName: 'store-02' },
      ],
      totalCount: 2,
    };
    const offVm = { ...healthyVmDetail, powerState: 'OFF' };

    const runProbe: RunProbe = async (probe) => {
      if (probe === 'nutanix.categories.entities') return mockResult(probe, entities);
      if (probe === 'nutanix.vm.detail') return mockResult(probe, offVm);
      if (probe === 'nutanix.vm.stats') return mockResult(probe, healthyVmStats);
      if (probe === 'nutanix.alerts.list') return mockResult(probe, emptyAlerts);
      return mockResult(probe, undefined, 'error');
    };

    const result = await handler(
      { category_key: 'App', category_value: 'Store' },
      runProbe,
      defaultContext,
    );

    const perVmOff = result.findings.filter(
      (f) => f.severity === 'warning' && f.title.includes('powered off'),
    );
    expect(perVmOff).toHaveLength(2);

    // Also should have "all VMs powered off" critical finding
    const allOff = result.findings.find(
      (f) => f.severity === 'critical' && f.title.includes('powered off'),
    );
    expect(allOff).toBeDefined();
  });

  it('high CPU on tagged VMs — warning', async () => {
    const entities = {
      entities: [{ entityType: 'vm', entityId: 'vm-001', entityName: 'store-01' }],
      totalCount: 1,
    };
    const highCpuStats = { ...healthyVmStats, cpuUsagePct: 92 };

    const runProbe: RunProbe = async (probe) => {
      if (probe === 'nutanix.categories.entities') return mockResult(probe, entities);
      if (probe === 'nutanix.vm.detail') return mockResult(probe, healthyVmDetail);
      if (probe === 'nutanix.vm.stats') return mockResult(probe, highCpuStats);
      if (probe === 'nutanix.alerts.list') return mockResult(probe, emptyAlerts);
      return mockResult(probe, undefined, 'error');
    };

    const result = await handler(
      { category_key: 'App', category_value: 'Store' },
      runProbe,
      defaultContext,
    );

    const warning = result.findings.find((f) => f.title.includes('CPU'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('critical alerts on tagged VMs — critical', async () => {
    const entities = {
      entities: [{ entityType: 'vm', entityId: 'vm-001', entityName: 'web-01' }],
      totalCount: 1,
    };
    const vmAlerts = {
      alerts: [
        {
          title: 'Disk failure',
          severity: 'CRITICAL',
          sourceEntity: { type: 'vm', name: 'web-01', extId: 'vm-001' },
          creationTime: '2026-02-17T10:00:00Z',
        },
      ],
      totalCount: 1,
    };

    const runProbe: RunProbe = async (probe) => {
      if (probe === 'nutanix.categories.entities') return mockResult(probe, entities);
      if (probe === 'nutanix.vm.detail') return mockResult(probe, healthyVmDetail);
      if (probe === 'nutanix.vm.stats') return mockResult(probe, healthyVmStats);
      if (probe === 'nutanix.alerts.list') return mockResult(probe, vmAlerts);
      return mockResult(probe, undefined, 'error');
    };

    const result = await handler(
      { category_key: 'Environment', category_value: 'Storefront' },
      runProbe,
      defaultContext,
    );

    const critical = result.findings.find((f) => f.title.includes('Disk failure'));
    expect(critical).toBeDefined();
    expect(critical?.severity).toBe('critical');
  });

  it('limits VM checks to 10', async () => {
    const entities = {
      entities: Array.from({ length: 15 }, (_, i) => ({
        entityType: 'vm',
        entityId: `vm-${i}`,
        entityName: `store-${i}`,
      })),
      totalCount: 15,
    };

    const vmDetailCalls: string[] = [];
    const runProbe: RunProbe = async (probe, params) => {
      if (probe === 'nutanix.categories.entities') return mockResult(probe, entities);
      if (probe === 'nutanix.vm.detail') {
        vmDetailCalls.push(params?.vm_id as string);
        return mockResult(probe, healthyVmDetail);
      }
      if (probe === 'nutanix.vm.stats') return mockResult(probe, healthyVmStats);
      if (probe === 'nutanix.alerts.list') return mockResult(probe, emptyAlerts);
      return mockResult(probe, undefined, 'error');
    };

    await handler({ category_key: 'App', category_value: 'Store' }, runProbe, defaultContext);

    // Should only check first 10 VMs
    expect(vmDetailCalls).toHaveLength(10);
  });
});

// =============================================================================
// Definitions
// =============================================================================

describe('nutanixDiagnosticRunbooks definitions', () => {
  it('exports 4 runbook definitions', () => {
    expect(nutanixDiagnosticRunbooks).toHaveLength(4);
  });

  it('has correct categories', () => {
    const categories = nutanixDiagnosticRunbooks.map((r) => r.category);
    expect(categories).toContain('nutanix-cluster-health');
    expect(categories).toContain('nutanix-vm-health');
    expect(categories).toContain('nutanix-capacity-planning');
    expect(categories).toContain('nutanix-storefront-investigate');
  });

  it('nutanix-vm-health has vm_id and vm_name params', () => {
    const def = nutanixDiagnosticRunbooks.find((r) => r.category === 'nutanix-vm-health');
    expect(def?.params?.vm_id).toBeDefined();
    expect(def?.params?.vm_name).toBeDefined();
  });

  it('nutanix-storefront-investigate requires category_key and category_value', () => {
    const def = nutanixDiagnosticRunbooks.find(
      (r) => r.category === 'nutanix-storefront-investigate',
    );
    expect(def?.params?.category_key?.required).toBe(true);
    expect(def?.params?.category_value?.required).toBe(true);
  });

  it('nutanix-cluster-health has no required params', () => {
    const def = nutanixDiagnosticRunbooks.find((r) => r.category === 'nutanix-cluster-health');
    expect(def?.params).toBeUndefined();
  });

  it('nutanix-capacity-planning has no required params', () => {
    const def = nutanixDiagnosticRunbooks.find((r) => r.category === 'nutanix-capacity-planning');
    expect(def?.params).toBeUndefined();
  });
});
