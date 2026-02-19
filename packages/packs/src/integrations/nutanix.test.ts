import type { IntegrationConfig, IntegrationCredentials } from '@sonde/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildAuthHeaders, nutanixPack, nutanixUrl, ppmToPercent, usecsToMs } from './nutanix.js';

const ntnxConfig: IntegrationConfig = {
  endpoint: 'https://prism.local:9440',
};

const basicCreds: IntegrationCredentials = {
  packName: 'nutanix',
  authMethod: 'api_key',
  credentials: { username: 'admin', password: 'secret123' },
};

const apiKeyCreds: IntegrationCredentials = {
  packName: 'nutanix',
  authMethod: 'bearer_token',
  credentials: { nutanixApiKey: 'ntnx-api-key-abc123' },
};

const handler = (name: string) => {
  const h = nutanixPack.handlers[name];
  if (!h) throw new Error(`Handler ${name} not found`);
  return h;
};

function callArgs(fn: ReturnType<typeof vi.fn>, index: number): unknown[] {
  const args = fn.mock.calls[index];
  if (!args) throw new Error(`No call at index ${index}`);
  return args;
}

function mockNtnxResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function mockFetchError(status: number) {
  return vi.fn().mockResolvedValue(new Response('Error', { status, statusText: 'Error' }));
}

/** Decode URL fully (handles %24 → $ and + → space) */
function decodeUrl(url: string): string {
  return decodeURIComponent(url).replace(/\+/g, ' ');
}

/** Get a specific query param from a URL */
function getParam(url: string, key: string): string | null {
  return new URL(url).searchParams.get(key);
}

/** Wrap data in Nutanix v4 response envelope */
function v4Envelope(data: unknown, totalAvailableResults?: number) {
  return {
    data,
    $reserved: {},
    $objectType: 'base.v1.r0.a3.Response',
    metadata: totalAvailableResults != null ? { totalAvailableResults } : undefined,
  };
}

describe('nutanix pack', () => {
  describe('auth helpers', () => {
    it('builds Basic auth header for api_key method', () => {
      const headers = buildAuthHeaders(basicCreds);
      const expected = `Basic ${Buffer.from('admin:secret123').toString('base64')}`;
      expect(headers.Authorization).toBe(expected);
    });

    it('builds X-Ntnx-Api-Key header for bearer_token method', () => {
      const headers = buildAuthHeaders(apiKeyCreds);
      expect(headers['X-Ntnx-Api-Key']).toBe('ntnx-api-key-abc123');
      expect(headers.Authorization).toBeUndefined();
    });

    it('returns empty headers for missing credentials', () => {
      const emptyCreds: IntegrationCredentials = {
        packName: 'nutanix',
        authMethod: 'api_key',
        credentials: {},
      };
      const headers = buildAuthHeaders(emptyCreds);
      expect(Object.keys(headers)).toHaveLength(0);
    });
  });

  describe('nutanixUrl', () => {
    it('builds correct namespaced v4 URL', () => {
      const url = nutanixUrl('https://prism.local:9440', 'clustermgmt', 'config/clusters');
      expect(url).toBe('https://prism.local:9440/api/clustermgmt/v4.0/config/clusters');
    });

    it('includes query params', () => {
      const url = nutanixUrl('https://prism.local:9440', 'vmm', 'ahv/config/vms', {
        $limit: '50',
        $filter: "name eq 'test'",
      });
      expect(getParam(url, '$limit')).toBe('50');
      expect(getParam(url, '$filter')).toBe("name eq 'test'");
    });

    it('strips trailing slash from endpoint', () => {
      const url = nutanixUrl('https://prism.local:9440/', 'prism', 'config/tasks');
      expect(url).toBe('https://prism.local:9440/api/prism/v4.0/config/tasks');
    });
  });

  describe('unit conversions', () => {
    it('ppmToPercent converts correctly', () => {
      expect(ppmToPercent(250000)).toBe(25);
      expect(ppmToPercent(999999)).toBe(100);
      expect(ppmToPercent(0)).toBe(0);
      expect(ppmToPercent(123456)).toBe(12.35);
    });

    it('usecsToMs converts correctly', () => {
      expect(usecsToMs(1000)).toBe(1);
      expect(usecsToMs(1500)).toBe(1.5);
      expect(usecsToMs(0)).toBe(0);
      expect(usecsToMs(12345)).toBe(12.35);
    });
  });

  describe('envelope unwrap', () => {
    it('extracts data from v4 response wrapper', async () => {
      const fetchFn = mockNtnxResponse(v4Envelope([{ name: 'cluster-1' }], 42));
      const result = (await handler('clusters.list')({}, ntnxConfig, basicCreds, fetchFn)) as {
        clusters: unknown[];
        totalCount: number;
      };
      expect(result.clusters).toHaveLength(1);
      expect(result.totalCount).toBe(42);
    });
  });

  describe('clusters.list', () => {
    it('returns cluster list', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope(
          [
            {
              name: 'prod-cluster',
              extId: 'abc-123',
              hypervisorType: 'AHV',
              aosVersion: '6.5.1',
              numNodes: 4,
              redundancyFactor: 2,
              operationMode: 'NORMAL',
            },
          ],
          1,
        ),
      );

      const result = (await handler('clusters.list')({}, ntnxConfig, basicCreds, fetchFn)) as {
        clusters: Array<{ name: string; isDegraded: boolean }>;
        totalCount: number;
      };

      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0]?.name).toBe('prod-cluster');
      expect(result.clusters[0]?.isDegraded).toBe(false);
      expect(result.totalCount).toBe(1);
    });

    it('applies name filter via OData', async () => {
      const fetchFn = mockNtnxResponse(v4Envelope([]));
      await handler('clusters.list')({ name: 'prod' }, ntnxConfig, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0) as [string];
      expect(getParam(url, '$filter')).toBe("name eq 'prod'");
    });

    it('flags degraded clusters', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope([{ name: 'degraded-cluster', operationMode: 'STANDBY' }]),
      );

      const result = (await handler('clusters.list')({}, ntnxConfig, basicCreds, fetchFn)) as {
        clusters: Array<{ isDegraded: boolean }>;
      };

      expect(result.clusters[0]?.isDegraded).toBe(true);
    });
  });

  describe('hosts.list', () => {
    it('returns hosts', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope(
          [
            {
              hostName: 'node-01',
              extId: 'h-123',
              serialNumber: 'SN001',
              blockModel: 'NX-1065',
              numCpuSockets: 2,
              numCpuCores: 16,
              memoryCapacityBytes: 137438953472,
              maintenanceMode: false,
            },
          ],
          1,
        ),
      );

      const result = (await handler('hosts.list')({}, ntnxConfig, basicCreds, fetchFn)) as {
        hosts: Array<{ name: string; maintenanceMode: boolean }>;
        totalCount: number;
      };

      expect(result.hosts).toHaveLength(1);
      expect(result.hosts[0]?.name).toBe('node-01');
      expect(result.hosts[0]?.maintenanceMode).toBe(false);
    });

    it('applies cluster_id filter', async () => {
      const fetchFn = mockNtnxResponse(v4Envelope([]));
      await handler('hosts.list')({ cluster_id: 'c-123' }, ntnxConfig, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0) as [string];
      expect(getParam(url, '$filter')).toBe("clusterExtId eq 'c-123'");
    });
  });

  describe('vms.list', () => {
    it('returns VMs', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope(
          [
            {
              name: 'web-01',
              extId: 'vm-123',
              powerState: 'ON',
              numSockets: 2,
              numCoresPerSocket: 4,
              memorySizeBytes: 4294967296,
            },
          ],
          1,
        ),
      );

      const result = (await handler('vms.list')({}, ntnxConfig, basicCreds, fetchFn)) as {
        vms: Array<{ name: string; memorySizeMb: number }>;
      };

      expect(result.vms).toHaveLength(1);
      expect(result.vms[0]?.name).toBe('web-01');
      expect(result.vms[0]?.memorySizeMb).toBe(4096);
    });

    it('combines multiple OData filters', async () => {
      const fetchFn = mockNtnxResponse(v4Envelope([]));
      await handler('vms.list')(
        { name: 'web', power_state: 'ON', cluster_id: 'c-1' },
        ntnxConfig,
        basicCreds,
        fetchFn,
      );

      const [url] = callArgs(fetchFn, 0) as [string];
      const filter = getParam(url, '$filter') ?? '';
      expect(filter).toContain("name eq 'web'");
      expect(filter).toContain("powerState eq 'ON'");
      expect(filter).toContain("clusterExtId eq 'c-1'");
      expect(filter).toContain(' and ');
    });

    it('uses default limit of 50', async () => {
      const fetchFn = mockNtnxResponse(v4Envelope([]));
      await handler('vms.list')({}, ntnxConfig, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0) as [string];
      expect(getParam(url, '$limit')).toBe('50');
    });
  });

  describe('vm.detail', () => {
    it('parses full VM config with disks and NICs', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope({
          name: 'db-01',
          extId: 'vm-456',
          powerState: 'ON',
          numSockets: 4,
          numCoresPerSocket: 2,
          memorySizeBytes: 8589934592,
          disks: [
            {
              backingInfo: {
                deviceType: 'DISK',
                storageContainerId: 'sc-1',
                diskSizeBytes: 107374182400,
              },
            },
          ],
          nics: [
            {
              networkInfo: {
                macAddress: 'AA:BB:CC:DD:EE:FF',
                subnet: { extId: 'subnet-1' },
                nicType: 'NORMAL_NIC',
                isConnected: true,
              },
            },
          ],
          bootConfig: { bootType: 'UEFI' },
          categories: [{ key: 'Environment', value: 'Production' }],
          guestTools: { isInstalled: true },
          createTime: '2024-01-15T10:00:00Z',
        }),
      );

      const result = (await handler('vm.detail')(
        { vm_id: 'vm-456' },
        ntnxConfig,
        basicCreds,
        fetchFn,
      )) as {
        name: string;
        disks: Array<{ deviceType: string; sizeBytes: number }>;
        nics: Array<{ macAddress: string; subnetExtId: string }>;
        totalStorageBytes: number;
        bootConfig: unknown;
        guestTools: unknown;
      };

      expect(result.name).toBe('db-01');
      expect(result.disks).toHaveLength(1);
      expect(result.disks[0]?.deviceType).toBe('DISK');
      expect(result.disks[0]?.sizeBytes).toBe(107374182400);
      expect(result.nics).toHaveLength(1);
      expect(result.nics[0]?.macAddress).toBe('AA:BB:CC:DD:EE:FF');
      expect(result.nics[0]?.subnetExtId).toBe('subnet-1');
      expect(result.totalStorageBytes).toBe(107374182400);
      expect(result.bootConfig).toEqual({ bootType: 'UEFI' });
    });

    it('requires vm_id parameter', async () => {
      const fetchFn = mockNtnxResponse({});
      await expect(handler('vm.detail')({}, ntnxConfig, basicCreds, fetchFn)).rejects.toThrow(
        'vm_id parameter is required',
      );
    });
  });

  describe('vm.stats', () => {
    it('converts ppm to percent and usecs to ms', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          { metricType: 'CPU_USAGE_PPM', value: 250000 },
          { metricType: 'MEMORY_USAGE_PPM', value: 750000 },
          { metricType: 'IOPS', value: 500 },
          { metricType: 'IO_BANDWIDTH_KBPS', value: 102400 },
          { metricType: 'AVG_IO_LATENCY_USECS', value: 5000 },
          { metricType: 'NETWORK_RX_BYTES', value: 1048576 },
          { metricType: 'NETWORK_TX_BYTES', value: 524288 },
        ]),
      );

      const result = (await handler('vm.stats')(
        { vm_id: 'vm-123' },
        ntnxConfig,
        basicCreds,
        fetchFn,
      )) as {
        cpuUsagePct: number;
        memoryUsagePct: number;
        iops: number;
        ioBandwidthKbps: number;
        avgIoLatencyMs: number;
        networkRxBytes: number;
        networkTxBytes: number;
      };

      expect(result.cpuUsagePct).toBe(25);
      expect(result.memoryUsagePct).toBe(75);
      expect(result.iops).toBe(500);
      expect(result.ioBandwidthKbps).toBe(102400);
      expect(result.avgIoLatencyMs).toBe(5);
      expect(result.networkRxBytes).toBe(1048576);
      expect(result.networkTxBytes).toBe(524288);
    });

    it('requires vm_id parameter', async () => {
      const fetchFn = mockNtnxResponse({});
      await expect(handler('vm.stats')({}, ntnxConfig, basicCreds, fetchFn)).rejects.toThrow(
        'vm_id parameter is required',
      );
    });
  });

  describe('alerts.list', () => {
    it('returns alerts', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope(
          [
            {
              title: 'Disk failure',
              severity: 'CRITICAL',
              sourceEntity: { type: 'disk', name: 'sda', extId: 'd-1' },
              creationTime: '2024-01-15T10:00:00Z',
              resolvedStatus: 'UNRESOLVED',
            },
          ],
          1,
        ),
      );

      const result = (await handler('alerts.list')({}, ntnxConfig, basicCreds, fetchFn)) as {
        alerts: Array<{ title: string; severity: string }>;
        totalCount: number;
      };

      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0]?.title).toBe('Disk failure');
      expect(result.alerts[0]?.severity).toBe('CRITICAL');
    });

    it('applies severity filter', async () => {
      const fetchFn = mockNtnxResponse(v4Envelope([]));
      await handler('alerts.list')({ severity: 'CRITICAL' }, ntnxConfig, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0) as [string];
      const filter = getParam(url, '$filter') ?? '';
      expect(filter).toContain("severity eq 'CRITICAL'");
    });

    it('applies time range filter', async () => {
      const fetchFn = mockNtnxResponse(v4Envelope([]));
      await handler('alerts.list')({ hours: 4 }, ntnxConfig, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0) as [string];
      const filter = getParam(url, '$filter') ?? '';
      expect(filter).toContain('creationTime ge');
    });

    it('applies resolved filter', async () => {
      const fetchFn = mockNtnxResponse(v4Envelope([]));
      await handler('alerts.list')({ resolved: false }, ntnxConfig, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0) as [string];
      const filter = getParam(url, '$filter') ?? '';
      expect(filter).toContain("resolvedStatus eq 'UNRESOLVED'");
    });
  });

  describe('alerts.summary', () => {
    it('aggregates alerts by severity and entity type', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          {
            severity: 'CRITICAL',
            resolvedStatus: 'UNRESOLVED',
            title: 'Disk fail',
            sourceEntity: { type: 'disk', name: 'sda' },
            creationTime: '2024-01-15T10:00:00Z',
          },
          {
            severity: 'WARNING',
            resolvedStatus: 'RESOLVED',
            title: 'High CPU',
            sourceEntity: { type: 'vm' },
          },
          {
            severity: 'CRITICAL',
            resolvedStatus: 'RESOLVED',
            title: 'Memory',
            sourceEntity: { type: 'host' },
          },
          {
            severity: 'INFO',
            resolvedStatus: 'UNRESOLVED',
            title: 'Info alert',
            sourceEntity: { type: 'vm' },
          },
        ]),
      );

      const result = (await handler('alerts.summary')({}, ntnxConfig, basicCreds, fetchFn)) as {
        bySeverity: Record<string, number>;
        byEntityType: Record<string, number>;
        unresolvedCritical: unknown[];
        totalCount: number;
      };

      expect(result.bySeverity.CRITICAL).toBe(2);
      expect(result.bySeverity.WARNING).toBe(1);
      expect(result.bySeverity.INFO).toBe(1);
      expect(result.byEntityType.disk).toBe(1);
      expect(result.byEntityType.vm).toBe(2);
      expect(result.byEntityType.host).toBe(1);
      expect(result.unresolvedCritical).toHaveLength(1);
      expect(result.totalCount).toBe(4);
    });
  });

  describe('storage.containers', () => {
    it('returns containers with usage', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope(
          [
            {
              name: 'default-container',
              extId: 'sc-1',
              maxCapacityBytes: 1099511627776,
              usedBytes: 549755813888,
              replicationFactor: 2,
              compressionEnabled: true,
            },
          ],
          1,
        ),
      );

      const result = (await handler('storage.containers')({}, ntnxConfig, basicCreds, fetchFn)) as {
        containers: Array<{ name: string; usedPct: number; highUsage: boolean }>;
      };

      expect(result.containers).toHaveLength(1);
      expect(result.containers[0]?.name).toBe('default-container');
      expect(result.containers[0]?.usedPct).toBe(50);
      expect(result.containers[0]?.highUsage).toBe(false);
    });

    it('flags containers >85% used', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          {
            name: 'full-container',
            maxCapacityBytes: 1000,
            usedBytes: 900,
          },
        ]),
      );

      const result = (await handler('storage.containers')({}, ntnxConfig, basicCreds, fetchFn)) as {
        containers: Array<{ highUsage: boolean; usedPct: number }>;
      };

      expect(result.containers[0]?.highUsage).toBe(true);
      expect(result.containers[0]?.usedPct).toBe(90);
    });

    it('applies cluster_id filter', async () => {
      const fetchFn = mockNtnxResponse(v4Envelope([]));
      await handler('storage.containers')({ cluster_id: 'c-1' }, ntnxConfig, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0) as [string];
      expect(getParam(url, '$filter')).toBe("clusterExtId eq 'c-1'");
    });
  });

  describe('categories.list', () => {
    it('returns categories', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope(
          [
            {
              key: 'Environment',
              value: 'Production',
              type: 'USER',
              description: 'Environment tag',
            },
            { key: 'Environment', value: 'Staging', type: 'USER' },
          ],
          2,
        ),
      );

      const result = (await handler('categories.list')({}, ntnxConfig, basicCreds, fetchFn)) as {
        categories: Array<{ key: string; value: string }>;
        totalCount: number;
      };

      expect(result.categories).toHaveLength(2);
      expect(result.totalCount).toBe(2);
    });

    it('applies key filter', async () => {
      const fetchFn = mockNtnxResponse(v4Envelope([]));
      await handler('categories.list')({ key: 'Environment' }, ntnxConfig, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0) as [string];
      expect(getParam(url, '$filter')).toBe("key eq 'Environment'");
    });
  });

  describe('categories.entities', () => {
    it('posts v3 category query and returns entities', async () => {
      const fetchFn = mockNtnxResponse({
        results: [
          {
            kind: 'vm',
            kind_reference_list: [
              { kind: 'vm', uuid: 'vm-1', name: 'web-01' },
              { kind: 'vm', uuid: 'vm-2', name: 'web-02' },
            ],
          },
        ],
      });

      const result = (await handler('categories.entities')(
        { key: 'Environment', value: 'Production' },
        ntnxConfig,
        basicCreds,
        fetchFn,
      )) as {
        entities: Array<{ entityType: string; entityId: string; entityName: string }>;
        totalCount: number;
      };

      expect(result.entities).toHaveLength(2);
      expect(result.entities[0]?.entityType).toBe('vm');
      expect(result.entities[0]?.entityId).toBe('vm-1');
      expect(result.totalCount).toBe(2);

      // Verify it POSTed to v3 URL
      const [url, opts] = callArgs(fetchFn, 0) as [string, { method: string; body: string }];
      expect(url).toContain('/api/nutanix/v3/category/query');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.category_filter.params.Environment).toEqual(['Production']);
    });

    it('requires key and value parameters', async () => {
      const fetchFn = mockNtnxResponse({});
      await expect(
        handler('categories.entities')({}, ntnxConfig, basicCreds, fetchFn),
      ).rejects.toThrow('key parameter is required');

      await expect(
        handler('categories.entities')({ key: 'Env' }, ntnxConfig, basicCreds, fetchFn),
      ).rejects.toThrow('value parameter is required');
    });
  });

  describe('networks.list', () => {
    it('returns subnets', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope(
          [
            {
              name: 'vlan-100',
              subnetType: 'VLAN',
              vlanId: 100,
              clusterExtId: 'c-1',
            },
          ],
          1,
        ),
      );

      const result = (await handler('networks.list')({}, ntnxConfig, basicCreds, fetchFn)) as {
        subnets: Array<{ name: string; type: string; vlanId: number }>;
      };

      expect(result.subnets).toHaveLength(1);
      expect(result.subnets[0]?.name).toBe('vlan-100');
      expect(result.subnets[0]?.type).toBe('VLAN');
      expect(result.subnets[0]?.vlanId).toBe(100);
    });

    it('applies cluster_id filter', async () => {
      const fetchFn = mockNtnxResponse(v4Envelope([]));
      await handler('networks.list')({ cluster_id: 'c-1' }, ntnxConfig, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0) as [string];
      expect(getParam(url, '$filter')).toBe("clusterExtId eq 'c-1'");
    });
  });

  describe('tasks.recent', () => {
    it('returns tasks with defaults', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope(
          [
            {
              operationType: 'kVmCreate',
              status: 'SUCCEEDED',
              startTime: '2024-01-15T10:00:00Z',
              completedTime: '2024-01-15T10:01:00Z',
              progressPercentage: 100,
            },
          ],
          1,
        ),
      );

      const result = (await handler('tasks.recent')({}, ntnxConfig, basicCreds, fetchFn)) as {
        tasks: Array<{ type: string; status: string; isFailed: boolean; isLongRunning: boolean }>;
      };

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]?.type).toBe('kVmCreate');
      expect(result.tasks[0]?.isFailed).toBe(false);
      expect(result.tasks[0]?.isLongRunning).toBe(false);
    });

    it('detects failed tasks', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          {
            operationType: 'kVmUpdate',
            status: 'FAILED',
            startTime: '2024-01-15T10:00:00Z',
            errorMessages: [{ message: 'Out of memory' }],
          },
        ]),
      );

      const result = (await handler('tasks.recent')({}, ntnxConfig, basicCreds, fetchFn)) as {
        tasks: Array<{ isFailed: boolean; errorMessage: string }>;
      };

      expect(result.tasks[0]?.isFailed).toBe(true);
      expect(result.tasks[0]?.errorMessage).toBe('Out of memory');
    });

    it('detects long-running tasks (>1hr without end time)', async () => {
      const twoHoursAgo = new Date(Date.now() - 7200000).toISOString();
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          {
            operationType: 'kMigrate',
            status: 'RUNNING',
            startTime: twoHoursAgo,
          },
        ]),
      );

      const result = (await handler('tasks.recent')({}, ntnxConfig, basicCreds, fetchFn)) as {
        tasks: Array<{ isLongRunning: boolean }>;
      };

      expect(result.tasks[0]?.isLongRunning).toBe(true);
    });

    it('applies status filter', async () => {
      const fetchFn = mockNtnxResponse(v4Envelope([]));
      await handler('tasks.recent')({ status: 'FAILED' }, ntnxConfig, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0) as [string];
      const filter = getParam(url, '$filter') ?? '';
      expect(filter).toContain("status eq 'FAILED'");
    });
  });

  describe('cluster.health', () => {
    it('returns composite health assessment', async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // clusters list
          return Promise.resolve(
            new Response(
              JSON.stringify(v4Envelope([{ name: 'prod', extId: 'c-1', operationMode: 'NORMAL' }])),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        if (callCount === 2) {
          // hosts
          return Promise.resolve(
            new Response(
              JSON.stringify(
                v4Envelope([
                  { hostName: 'n1', extId: 'h-1', maintenanceMode: false },
                  { hostName: 'n2', extId: 'h-2', maintenanceMode: false },
                ]),
              ),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        if (callCount === 3) {
          // critical alerts
          return Promise.resolve(
            new Response(JSON.stringify(v4Envelope([])), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        // storage
        return Promise.resolve(
          new Response(
            JSON.stringify(
              v4Envelope([{ name: 'default', maxCapacityBytes: 1000, usedBytes: 400 }]),
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      const result = (await handler('cluster.health')({}, ntnxConfig, basicCreds, fetchFn)) as {
        cluster: { name: string };
        nodeCount: number;
        degradedNodes: unknown[];
        criticalAlerts: unknown[];
        healthAssessment: string;
        issues: string[];
      };

      expect(result.cluster.name).toBe('prod');
      expect(result.nodeCount).toBe(2);
      expect(result.degradedNodes).toHaveLength(0);
      expect(result.criticalAlerts).toHaveLength(0);
      expect(result.healthAssessment).toBe('HEALTHY');
      expect(result.issues).toHaveLength(0);
    });

    it('returns CRITICAL when alerts or degraded nodes exist', async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify(v4Envelope([{ name: 'prod', extId: 'c-1' }])), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        if (callCount === 2) {
          return Promise.resolve(
            new Response(
              JSON.stringify(v4Envelope([{ hostName: 'n1', extId: 'h-1', maintenanceMode: true }])),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        if (callCount === 3) {
          return Promise.resolve(
            new Response(
              JSON.stringify(v4Envelope([{ title: 'Critical!', severity: 'CRITICAL' }])),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(v4Envelope([])), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });

      const result = (await handler('cluster.health')({}, ntnxConfig, basicCreds, fetchFn)) as {
        healthAssessment: string;
        issues: string[];
      };

      expect(result.healthAssessment).toBe('CRITICAL');
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('returns WARNING when storage >85%', async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify(v4Envelope([{ name: 'prod', extId: 'c-1' }])), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        if (callCount === 2) {
          return Promise.resolve(
            new Response(JSON.stringify(v4Envelope([{ hostName: 'n1', maintenanceMode: false }])), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        if (callCount === 3) {
          return Promise.resolve(
            new Response(JSON.stringify(v4Envelope([])), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify(
              v4Envelope([{ name: 'full-sc', maxCapacityBytes: 1000, usedBytes: 900 }]),
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      const result = (await handler('cluster.health')({}, ntnxConfig, basicCreds, fetchFn)) as {
        healthAssessment: string;
      };

      expect(result.healthAssessment).toBe('WARNING');
    });
  });

  describe('testConnection', () => {
    it('returns true on successful cluster query', async () => {
      const fetchFn = mockNtnxResponse(v4Envelope([{ name: 'cluster-1' }]));
      const result = await nutanixPack.testConnection(ntnxConfig, basicCreds, fetchFn);
      expect(result).toBe(true);

      const [url] = callArgs(fetchFn, 0) as [string];
      expect(url).toContain('/api/clustermgmt/v4.0/config/clusters');
      expect(getParam(url, '$limit')).toBe('1');
    });

    it('returns false on 401', async () => {
      const fetchFn = mockFetchError(401);
      const result = await nutanixPack.testConnection(ntnxConfig, basicCreds, fetchFn);
      expect(result).toBe(false);
    });

    it('throws on network error', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(nutanixPack.testConnection(ntnxConfig, basicCreds, fetchFn))
        .rejects.toThrow('ECONNREFUSED');
    });

    it('returns false when data is null', async () => {
      const fetchFn = mockNtnxResponse({ data: null });
      const result = await nutanixPack.testConnection(ntnxConfig, basicCreds, fetchFn);
      expect(result).toBe(false);
    });
  });

  describe('manifest', () => {
    it('has correct name and 20 probes', () => {
      expect(nutanixPack.manifest.name).toBe('nutanix');
      expect(nutanixPack.manifest.probes).toHaveLength(20);
    });

    it('all handlers match manifest probes', () => {
      const probeNames = nutanixPack.manifest.probes.map((p) => p.name);
      const handlerNames = Object.keys(nutanixPack.handlers);
      expect(handlerNames.sort()).toEqual(probeNames.sort());
    });

    it('all probes have observe capability', () => {
      for (const probe of nutanixPack.manifest.probes) {
        expect(probe.capability).toBe('observe');
      }
    });

    it('has correct timeouts (30s for vm.stats and cluster.health, 15s for others)', () => {
      const probeMap = new Map(nutanixPack.manifest.probes.map((p) => [p.name, p.timeout]));
      expect(probeMap.get('vm.stats')).toBe(30000);
      expect(probeMap.get('cluster.health')).toBe(30000);
      for (const [name, timeout] of probeMap) {
        if (name !== 'vm.stats' && name !== 'cluster.health') {
          expect(timeout).toBe(15000);
        }
      }
    });

    it('has hyperconverged runbook', () => {
      expect(nutanixPack.manifest.runbook).toEqual({
        category: 'hyperconverged',
        probes: ['clusters.list', 'alerts.summary', 'storage.containers'],
        parallel: true,
      });
    });
  });

  describe('vm.snapshots', () => {
    it('returns snapshots via v4 API', async () => {
      const now = new Date().toISOString();
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          {
            name: 'daily-snap',
            extId: 'rp-1',
            creationTime: now,
            expirationTime: new Date(Date.now() + 86400000).toISOString(),
            recoveryPointType: 'CRASH_CONSISTENT',
            sizeBytes: 1073741824,
          },
        ]),
      );

      const result = (await handler('vm.snapshots')(
        { vm_id: 'vm-1' },
        ntnxConfig,
        basicCreds,
        fetchFn,
      )) as {
        snapshots: Array<{
          name: string;
          isOld: boolean;
          isExpired: boolean;
          consistencyType: string;
        }>;
        totalCount: number;
        usedV3: boolean;
        warnings: string[];
      };

      expect(result.snapshots).toHaveLength(1);
      expect(result.snapshots[0]?.name).toBe('daily-snap');
      expect(result.snapshots[0]?.isOld).toBe(false);
      expect(result.snapshots[0]?.isExpired).toBe(false);
      expect(result.snapshots[0]?.consistencyType).toBe('CRASH_CONSISTENT');
      expect(result.usedV3).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it('flags old snapshots (>7 days)', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString();
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          { name: 'old-snap', creationTime: eightDaysAgo, recoveryPointType: 'APP_CONSISTENT' },
        ]),
      );

      const result = (await handler('vm.snapshots')(
        { vm_id: 'vm-1' },
        ntnxConfig,
        basicCreds,
        fetchFn,
      )) as {
        snapshots: Array<{ isOld: boolean; ageDays: number }>;
        warnings: string[];
      };

      expect(result.snapshots[0]?.isOld).toBe(true);
      expect(result.snapshots[0]?.ageDays).toBeGreaterThan(7);
      expect(result.warnings.some((w: string) => w.includes('older than 7 days'))).toBe(true);
    });

    it('flags expired snapshots not cleaned up', async () => {
      const pastExpiration = new Date(Date.now() - 86400000).toISOString();
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          {
            name: 'expired-snap',
            creationTime: new Date(Date.now() - 2 * 86400000).toISOString(),
            expirationTime: pastExpiration,
          },
        ]),
      );

      const result = (await handler('vm.snapshots')(
        { vm_id: 'vm-1' },
        ntnxConfig,
        basicCreds,
        fetchFn,
      )) as {
        snapshots: Array<{ isExpired: boolean }>;
        warnings: string[];
      };

      expect(result.snapshots[0]?.isExpired).toBe(true);
      expect(result.warnings.some((w: string) => w.includes('expired'))).toBe(true);
    });

    it('falls back to v3 API when v4 fails', async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (callCount === 1) {
          // v4 fails
          return Promise.resolve(
            new Response('Not Found', { status: 404, statusText: 'Not Found' }),
          );
        }
        // v3 succeeds
        return Promise.resolve(
          new Response(
            JSON.stringify({
              entities: [
                {
                  status: {
                    name: 'v3-snap',
                    creation_time: new Date().toISOString(),
                    recovery_point_type: 'CRASH_CONSISTENT',
                  },
                  extId: 'rp-v3',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      const result = (await handler('vm.snapshots')(
        { vm_id: 'vm-1' },
        ntnxConfig,
        basicCreds,
        fetchFn,
      )) as { snapshots: unknown[]; usedV3: boolean };

      expect(result.usedV3).toBe(true);
      expect(result.snapshots).toHaveLength(1);
    });

    it('requires vm_id parameter', async () => {
      const fetchFn = mockNtnxResponse({});
      await expect(handler('vm.snapshots')({}, ntnxConfig, basicCreds, fetchFn)).rejects.toThrow(
        'vm_id parameter is required',
      );
    });
  });

  describe('protection.policies', () => {
    it('returns all policies', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope(
          [
            {
              name: 'daily-backup',
              extId: 'pp-1',
              schedules: [
                { recoveryPointObjective: 60, rpoUnit: 'MINUTES', localRetentionCount: 7 },
              ],
              protectedEntities: [{ extId: 'vm-1' }, { extId: 'vm-2' }],
              lastSuccessfulReplicationTime: '2024-01-15T10:00:00Z',
            },
          ],
          1,
        ),
      );

      const result = (await handler('protection.policies')(
        {},
        ntnxConfig,
        basicCreds,
        fetchFn,
      )) as {
        policies: Array<{ name: string; protectedEntityCount: number; rpo: { value: number } }>;
        totalCount: number;
      };

      expect(result.policies).toHaveLength(1);
      expect(result.policies[0]?.name).toBe('daily-backup');
      expect(result.policies[0]?.protectedEntityCount).toBe(2);
      expect(result.policies[0]?.rpo?.value).toBe(60);
    });

    it('filters by vm_id and reports coverage', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          {
            name: 'covers-vm1',
            extId: 'pp-1',
            protectedEntities: [{ extId: 'vm-1' }],
            schedules: [],
          },
          {
            name: 'other-policy',
            extId: 'pp-2',
            protectedEntities: [{ extId: 'vm-99' }],
            schedules: [],
          },
        ]),
      );

      const result = (await handler('protection.policies')(
        { vm_id: 'vm-1' },
        ntnxConfig,
        basicCreds,
        fetchFn,
      )) as {
        policies: Array<{ name: string }>;
        vmCovered: boolean;
        allPoliciesCount: number;
      };

      expect(result.policies).toHaveLength(1);
      expect(result.policies[0]?.name).toBe('covers-vm1');
      expect(result.vmCovered).toBe(true);
      expect(result.allPoliciesCount).toBe(2);
    });

    it('reports uncovered VM', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          {
            name: 'policy-1',
            extId: 'pp-1',
            protectedEntities: [{ extId: 'vm-99' }],
            schedules: [],
          },
        ]),
      );

      const result = (await handler('protection.policies')(
        { vm_id: 'vm-orphan' },
        ntnxConfig,
        basicCreds,
        fetchFn,
      )) as { vmCovered: boolean; totalCount: number };

      expect(result.vmCovered).toBe(false);
      expect(result.totalCount).toBe(0);
    });
  });

  describe('lifecycle.status', () => {
    it('returns LCM entities with update detection', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          {
            entityType: 'AOS',
            name: 'AOS',
            extId: 'lcm-1',
            installedVersion: { version: '6.5.1' },
            availableVersion: { version: '6.5.2' },
          },
          {
            entityType: 'NCC',
            name: 'NCC',
            extId: 'lcm-2',
            installedVersion: { version: '4.6.0' },
            availableVersion: { version: '4.6.0' },
          },
        ]),
      );

      const result = (await handler('lifecycle.status')({}, ntnxConfig, basicCreds, fetchFn)) as {
        entities: Array<{
          entityType: string;
          hasUpdate: boolean;
          currentVersion: string;
          availableVersion: string;
        }>;
        updatableCount: number;
        warnings: string[];
      };

      expect(result.entities).toHaveLength(2);
      expect(result.entities[0]?.hasUpdate).toBe(true);
      expect(result.entities[0]?.currentVersion).toBe('6.5.1');
      expect(result.entities[0]?.availableVersion).toBe('6.5.2');
      expect(result.entities[1]?.hasUpdate).toBe(false);
      expect(result.updatableCount).toBe(1);
      expect(result.warnings.some((w: string) => w.includes('1 component(s)'))).toBe(true);
      expect(result.warnings.some((w: string) => w.includes('6.5.1'))).toBe(true);
    });

    it('returns no warnings when everything is current', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          {
            entityType: 'AOS',
            installedVersion: { version: '6.5.2' },
            availableVersion: { version: '6.5.2' },
          },
        ]),
      );

      const result = (await handler('lifecycle.status')({}, ntnxConfig, basicCreds, fetchFn)) as {
        updatableCount: number;
        warnings: string[];
      };

      expect(result.updatableCount).toBe(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('host.stats', () => {
    it('returns host metrics with ppm conversion', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          { metricType: 'HYPERVISOR_CPU_USAGE_PPM', value: 500000 },
          { metricType: 'HYPERVISOR_MEMORY_USAGE_PPM', value: 700000 },
          { metricType: 'IOPS', value: 1200 },
          { metricType: 'IO_BANDWIDTH_KBPS', value: 204800 },
          { metricType: 'NETWORK_RX_BYTES', value: 2097152 },
          { metricType: 'NETWORK_TX_BYTES', value: 1048576 },
          { metricType: 'HYPERVISOR_UPTIME_USECS', value: 86400000000 },
        ]),
      );

      const result = (await handler('host.stats')(
        { host_id: 'h-1' },
        ntnxConfig,
        basicCreds,
        fetchFn,
      )) as {
        cpuUsagePct: number;
        memoryUsagePct: number;
        iops: number;
        warnings: string[];
      };

      expect(result.cpuUsagePct).toBe(50);
      expect(result.memoryUsagePct).toBe(70);
      expect(result.iops).toBe(1200);
      expect(result.warnings).toHaveLength(0);
    });

    it('flags high CPU (>85%)', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          { metricType: 'HYPERVISOR_CPU_USAGE_PPM', value: 900000 },
          { metricType: 'HYPERVISOR_MEMORY_USAGE_PPM', value: 500000 },
        ]),
      );

      const result = (await handler('host.stats')(
        { host_id: 'h-1' },
        ntnxConfig,
        basicCreds,
        fetchFn,
      )) as { cpuUsagePct: number; warnings: string[] };

      expect(result.cpuUsagePct).toBe(90);
      expect(result.warnings.some((w: string) => w.includes('CPU at 90%'))).toBe(true);
    });

    it('flags high memory (>90%)', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          { metricType: 'HYPERVISOR_CPU_USAGE_PPM', value: 200000 },
          { metricType: 'HYPERVISOR_MEMORY_USAGE_PPM', value: 950000 },
        ]),
      );

      const result = (await handler('host.stats')(
        { host_id: 'h-1' },
        ntnxConfig,
        basicCreds,
        fetchFn,
      )) as { memoryUsagePct: number; warnings: string[] };

      expect(result.memoryUsagePct).toBe(95);
      expect(result.warnings.some((w: string) => w.includes('memory at 95%'))).toBe(true);
    });

    it('requires host_id parameter', async () => {
      const fetchFn = mockNtnxResponse({});
      await expect(handler('host.stats')({}, ntnxConfig, basicCreds, fetchFn)).rejects.toThrow(
        'host_id parameter is required',
      );
    });
  });

  describe('cluster.stats', () => {
    it('returns aggregate cluster metrics with utilization percentages', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope([
          { metricType: 'CPU_CAPACITY_HZ', value: 100000000000 },
          { metricType: 'CPU_USAGE_HZ', value: 40000000000 },
          { metricType: 'MEMORY_CAPACITY_BYTES', value: 274877906944 },
          { metricType: 'MEMORY_USAGE_BYTES', value: 137438953472 },
          { metricType: 'STORAGE_CAPACITY_BYTES', value: 10995116277760 },
          { metricType: 'STORAGE_USAGE_BYTES', value: 5497558138880 },
          { metricType: 'IOPS', value: 5000 },
          { metricType: 'AVG_IO_LATENCY_USECS', value: 2000 },
        ]),
      );

      const result = (await handler('cluster.stats')(
        { cluster_id: 'c-1' },
        ntnxConfig,
        basicCreds,
        fetchFn,
      )) as {
        cpuUsagePct: number;
        memoryUsagePct: number;
        storageUsagePct: number;
        iops: number;
        avgIoLatencyMs: number;
      };

      expect(result.cpuUsagePct).toBe(40);
      expect(result.memoryUsagePct).toBe(50);
      expect(result.storageUsagePct).toBe(50);
      expect(result.iops).toBe(5000);
      expect(result.avgIoLatencyMs).toBe(2);
    });

    it('requires cluster_id parameter', async () => {
      const fetchFn = mockNtnxResponse({});
      await expect(handler('cluster.stats')({}, ntnxConfig, basicCreds, fetchFn)).rejects.toThrow(
        'cluster_id parameter is required',
      );
    });
  });

  describe('images.list', () => {
    it('returns images', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope(
          [
            {
              name: 'ubuntu-22.04',
              extId: 'img-1',
              type: 'DISK_IMAGE',
              sizeBytes: 2147483648,
              description: 'Ubuntu 22.04 LTS',
              createTime: '2024-01-10T08:00:00Z',
            },
            {
              name: 'windows-2022.iso',
              extId: 'img-2',
              type: 'ISO',
              sizeBytes: 5368709120,
            },
          ],
          2,
        ),
      );

      const result = (await handler('images.list')({}, ntnxConfig, basicCreds, fetchFn)) as {
        images: Array<{ name: string; type: string; sizeBytes: number }>;
        totalCount: number;
      };

      expect(result.images).toHaveLength(2);
      expect(result.images[0]?.name).toBe('ubuntu-22.04');
      expect(result.images[0]?.type).toBe('DISK_IMAGE');
      expect(result.images[1]?.type).toBe('ISO');
      expect(result.totalCount).toBe(2);
    });

    it('applies name filter', async () => {
      const fetchFn = mockNtnxResponse(v4Envelope([]));
      await handler('images.list')({ name: 'ubuntu' }, ntnxConfig, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0) as [string];
      expect(getParam(url, '$filter')).toBe("name eq 'ubuntu'");
    });
  });

  describe('vms.by_host', () => {
    it('returns VMs on a specific host', async () => {
      const fetchFn = mockNtnxResponse(
        v4Envelope(
          [
            {
              name: 'web-01',
              extId: 'vm-1',
              powerState: 'ON',
              numSockets: 2,
              memorySizeBytes: 4294967296,
            },
            {
              name: 'db-01',
              extId: 'vm-2',
              powerState: 'ON',
              numSockets: 4,
              memorySizeBytes: 8589934592,
            },
          ],
          2,
        ),
      );

      const result = (await handler('vms.by_host')(
        { host_id: 'h-1' },
        ntnxConfig,
        basicCreds,
        fetchFn,
      )) as {
        vms: Array<{ name: string; memorySizeMb: number }>;
        totalCount: number;
        hostId: string;
      };

      expect(result.vms).toHaveLength(2);
      expect(result.vms[0]?.name).toBe('web-01');
      expect(result.vms[0]?.memorySizeMb).toBe(4096);
      expect(result.vms[1]?.memorySizeMb).toBe(8192);
      expect(result.hostId).toBe('h-1');
      expect(result.totalCount).toBe(2);
    });

    it('applies hostExtId filter in URL', async () => {
      const fetchFn = mockNtnxResponse(v4Envelope([]));
      await handler('vms.by_host')({ host_id: 'h-42' }, ntnxConfig, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0) as [string];
      expect(getParam(url, '$filter')).toBe("hostExtId eq 'h-42'");
    });

    it('requires host_id parameter', async () => {
      const fetchFn = mockNtnxResponse({});
      await expect(handler('vms.by_host')({}, ntnxConfig, basicCreds, fetchFn)).rejects.toThrow(
        'host_id parameter is required',
      );
    });
  });

  describe('error handling', () => {
    it('throws on non-200 API response for probes', async () => {
      const fetchFn = mockFetchError(403);
      await expect(handler('clusters.list')({}, ntnxConfig, basicCreds, fetchFn)).rejects.toThrow(
        'Nutanix API returned 403',
      );
    });
  });
});
