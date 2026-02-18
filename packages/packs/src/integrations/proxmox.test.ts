import type { IntegrationConfig, IntegrationCredentials } from '@sonde/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildAuthHeaders, proxmoxGet, proxmoxPack, resolveNode } from './proxmox.js';

const pveConfig: IntegrationConfig = {
  endpoint: 'https://pve01.local:8006',
};

const pveCreds: IntegrationCredentials = {
  packName: 'proxmox',
  authMethod: 'api_key',
  credentials: { tokenId: 'sonde@pve!sonde-token', tokenSecret: 'secret-uuid' },
};

const handler = (name: string) => {
  const h = proxmoxPack.handlers[name];
  if (!h) throw new Error(`Handler ${name} not found`);
  return h;
};

function callArgs(fn: ReturnType<typeof vi.fn>, index: number): unknown[] {
  const args = fn.mock.calls[index];
  if (!args) throw new Error(`No call at index ${index}`);
  return args;
}

function mockPveResponse(body: unknown, status = 200) {
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

describe('proxmox pack', () => {
  describe('auth headers', () => {
    it('builds correct PVEAPIToken header', () => {
      const headers = buildAuthHeaders(pveCreds);
      expect(headers.Authorization).toBe('PVEAPIToken=sonde@pve!sonde-token=secret-uuid');
    });

    it('handles missing credentials gracefully', () => {
      const emptyCreds: IntegrationCredentials = {
        packName: 'proxmox',
        authMethod: 'api_key',
        credentials: {},
      };
      const headers = buildAuthHeaders(emptyCreds);
      expect(headers.Authorization).toBe('PVEAPIToken==');
    });
  });

  describe('proxmoxGet', () => {
    it('constructs correct URL with /api2/json prefix', async () => {
      const fetchFn = mockPveResponse({ data: {} });
      await proxmoxGet('/cluster/status', pveConfig, pveCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('https://pve01.local:8006/api2/json/cluster/status');
    });

    it('includes query params', async () => {
      const fetchFn = mockPveResponse({ data: [] });
      await proxmoxGet('/cluster/resources', pveConfig, pveCreds, fetchFn, { type: 'vm' });

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('type=vm');
    });

    it('throws on non-200 response', async () => {
      const fetchFn = mockFetchError(401);
      await expect(proxmoxGet('/version', pveConfig, pveCreds, fetchFn)).rejects.toThrow(
        'Proxmox API returned 401',
      );
    });
  });

  describe('testConnection', () => {
    it('returns true on GET /version success', async () => {
      const fetchFn = mockPveResponse({ data: { version: '8.1', release: '1', repoid: 'abc' } });
      const result = await proxmoxPack.testConnection(pveConfig, pveCreds, fetchFn);
      expect(result).toBe(true);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api2/json/version');
    });

    it('returns false on non-200', async () => {
      const fetchFn = mockFetchError(401);
      const result = await proxmoxPack.testConnection(pveConfig, pveCreds, fetchFn);
      expect(result).toBe(false);
    });

    it('returns false on network error', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await proxmoxPack.testConnection(pveConfig, pveCreds, fetchFn);
      expect(result).toBe(false);
    });
  });

  describe('resolveNode', () => {
    it('finds a qemu VM', async () => {
      const fetchFn = mockPveResponse({
        data: [
          { vmid: 100, node: 'pve01', type: 'qemu' },
          { vmid: 200, node: 'pve02', type: 'lxc' },
        ],
      });
      const result = await resolveNode(100, pveConfig, pveCreds, fetchFn);
      expect(result).toEqual({ node: 'pve01', type: 'qemu' });
    });

    it('finds an LXC container', async () => {
      const fetchFn = mockPveResponse({
        data: [
          { vmid: 100, node: 'pve01', type: 'qemu' },
          { vmid: 200, node: 'pve02', type: 'lxc' },
        ],
      });
      const result = await resolveNode(200, pveConfig, pveCreds, fetchFn);
      expect(result).toEqual({ node: 'pve02', type: 'lxc' });
    });

    it('throws when VMID not found', async () => {
      const fetchFn = mockPveResponse({ data: [] });
      await expect(resolveNode(999, pveConfig, pveCreds, fetchFn)).rejects.toThrow(
        'VM/container 999 not found in cluster',
      );
    });
  });

  describe('cluster.status', () => {
    it('returns cluster info with quorum', async () => {
      const fetchFn = mockPveResponse({
        data: [
          { name: 'mycluster', type: 'cluster', quorate: 1 },
          { name: 'pve01', type: 'node', online: 1, ip: '10.0.0.1' },
          { name: 'pve02', type: 'node', online: 1, ip: '10.0.0.2' },
        ],
      });

      const result = (await handler('cluster.status')({}, pveConfig, pveCreds, fetchFn)) as {
        clusterName: string;
        quorate: boolean;
        nodes: Array<{ name: string; online: boolean }>;
        warnings: string[];
      };

      expect(result.clusterName).toBe('mycluster');
      expect(result.quorate).toBe(true);
      expect(result.nodes).toHaveLength(2);
      expect(result.warnings).toHaveLength(0);
    });

    it('flags offline nodes and lost quorum', async () => {
      const fetchFn = mockPveResponse({
        data: [
          { name: 'mycluster', type: 'cluster', quorate: 0 },
          { name: 'pve01', type: 'node', online: 1 },
          { name: 'pve02', type: 'node', online: 0 },
        ],
      });

      const result = (await handler('cluster.status')({}, pveConfig, pveCreds, fetchFn)) as {
        warnings: string[];
      };

      expect(result.warnings).toContain('Cluster has lost quorum');
      expect(result.warnings).toContain('Node pve02 is offline');
    });
  });

  describe('cluster.ha.status', () => {
    it('returns HA status and resources', async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [{ id: 'manager', type: 'manager', status: 'active' }],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [{ sid: 'vm:100', state: 'started', node: 'pve01', type: 'vm' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      const result = (await handler('cluster.ha.status')({}, pveConfig, pveCreds, fetchFn)) as {
        managerStatus: string;
        resources: Array<{ sid: string; state: string }>;
        warnings: string[];
      };

      expect(result.managerStatus).toBe('active');
      expect(result.resources).toHaveLength(1);
      expect(result.warnings).toHaveLength(0);
    });

    it('flags error/fence states', async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ data: [{ id: 'manager', type: 'manager', status: 'active' }] }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                { sid: 'vm:100', state: 'error', node: 'pve01', type: 'vm' },
                { sid: 'vm:101', state: 'fence', node: 'pve02', type: 'vm' },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      const result = (await handler('cluster.ha.status')({}, pveConfig, pveCreds, fetchFn)) as {
        warnings: string[];
      };

      expect(result.warnings).toContain('HA resource vm:100 in error state');
      expect(result.warnings).toContain('HA resource vm:101 in fence state');
    });
  });

  describe('nodes.list', () => {
    it('returns node data', async () => {
      const fetchFn = mockPveResponse({
        data: [
          {
            node: 'pve01',
            status: 'online',
            uptime: 86400,
            cpu: 0.25,
            maxcpu: 8,
            mem: 4e9,
            maxmem: 16e9,
          },
          {
            node: 'pve02',
            status: 'online',
            uptime: 172800,
            cpu: 0.5,
            maxcpu: 8,
            mem: 8e9,
            maxmem: 16e9,
          },
        ],
      });

      const result = (await handler('nodes.list')({}, pveConfig, pveCreds, fetchFn)) as {
        nodes: Array<{ node: string; status: string }>;
        warnings: string[];
      };

      expect(result.nodes).toHaveLength(2);
      expect(result.warnings).toHaveLength(0);
    });

    it('flags offline nodes and high resource usage', async () => {
      const fetchFn = mockPveResponse({
        data: [
          { node: 'pve01', status: 'offline', cpu: 0.1, mem: 1e9, maxmem: 16e9 },
          { node: 'pve02', status: 'online', cpu: 0.95, mem: 15e9, maxmem: 16e9 },
        ],
      });

      const result = (await handler('nodes.list')({}, pveConfig, pveCreds, fetchFn)) as {
        warnings: string[];
      };

      expect(result.warnings).toContain('Node pve01 is offline');
      expect(result.warnings.some((w: string) => w.includes('pve02 CPU'))).toBe(true);
      expect(result.warnings.some((w: string) => w.includes('pve02 memory'))).toBe(true);
    });
  });

  describe('node.storage', () => {
    it('returns storage pools', async () => {
      const fetchFn = mockPveResponse({
        data: [
          {
            storage: 'local',
            type: 'dir',
            total: 100e9,
            used: 40e9,
            avail: 60e9,
            enabled: 1,
            active: 1,
          },
          {
            storage: 'ceph-pool',
            type: 'rbd',
            total: 1e12,
            used: 200e9,
            avail: 800e9,
            shared: 1,
            enabled: 1,
            active: 1,
          },
        ],
      });

      const result = (await handler('node.storage')(
        { node: 'pve01' },
        pveConfig,
        pveCreds,
        fetchFn,
      )) as {
        storages: Array<{ storage: string; shared: boolean }>;
        warnings: string[];
      };

      expect(result.storages).toHaveLength(2);
      expect(result.storages[1]?.shared).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('requires node parameter', async () => {
      const fetchFn = mockPveResponse({});
      await expect(handler('node.storage')({}, pveConfig, pveCreds, fetchFn)).rejects.toThrow(
        'node parameter is required',
      );
    });

    it('flags high usage and disabled storage', async () => {
      const fetchFn = mockPveResponse({
        data: [
          {
            storage: 'local',
            type: 'dir',
            total: 100e9,
            used: 90e9,
            avail: 10e9,
            enabled: 1,
            active: 1,
          },
          {
            storage: 'nfs',
            type: 'nfs',
            total: 100e9,
            used: 10e9,
            avail: 90e9,
            enabled: 0,
            active: 0,
          },
        ],
      });

      const result = (await handler('node.storage')(
        { node: 'pve01' },
        pveConfig,
        pveCreds,
        fetchFn,
      )) as {
        warnings: string[];
      };

      expect(result.warnings.some((w: string) => w.includes('local') && w.includes('90%'))).toBe(
        true,
      );
      expect(result.warnings).toContain('Storage nfs is disabled');
    });
  });

  describe('vm.status', () => {
    it('returns VM status', async () => {
      const fetchFn = mockPveResponse({
        data: [
          {
            vmid: 100,
            name: 'web-01',
            status: 'running',
            node: 'pve01',
            type: 'qemu',
            uptime: 3600,
            cpu: 0.1,
            mem: 2e9,
            maxmem: 4e9,
          },
        ],
      });

      const result = (await handler('vm.status')({ vmid: 100 }, pveConfig, pveCreds, fetchFn)) as {
        vmid: number;
        name: string;
        status: string;
        warnings: string[];
      };

      expect(result.vmid).toBe(100);
      expect(result.name).toBe('web-01');
      expect(result.warnings).toHaveLength(0);
    });

    it('throws when VM not found', async () => {
      const fetchFn = mockPveResponse({ data: [] });
      await expect(
        handler('vm.status')({ vmid: 999 }, pveConfig, pveCreds, fetchFn),
      ).rejects.toThrow('VM/container 999 not found');
    });

    it('requires vmid parameter', async () => {
      const fetchFn = mockPveResponse({});
      await expect(handler('vm.status')({}, pveConfig, pveCreds, fetchFn)).rejects.toThrow(
        'vmid parameter is required',
      );
    });

    it('flags stopped, locked, and HA error VMs', async () => {
      const fetchFn = mockPveResponse({
        data: [
          {
            vmid: 100,
            name: 'web-01',
            status: 'stopped',
            node: 'pve01',
            type: 'qemu',
            lock: 'backup',
            hastate: 'error',
          },
        ],
      });

      const result = (await handler('vm.status')({ vmid: 100 }, pveConfig, pveCreds, fetchFn)) as {
        warnings: string[];
      };

      expect(result.warnings).toContain('VM is stopped');
      expect(result.warnings).toContain('VM has lock: backup');
      expect(result.warnings).toContain('HA state: error');
    });
  });

  describe('vm.config', () => {
    it('parses disk entries from config', async () => {
      // First call: resolveNode
      // Second call: config
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ data: [{ vmid: 100, node: 'pve01', type: 'qemu' }] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                name: 'web-01',
                memory: 4096,
                cores: 2,
                scsi0: 'local-lvm:vm-100-disk-0,size=32G',
                ide2: 'none,media=cdrom',
                net0: 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      const result = (await handler('vm.config')({ vmid: 100 }, pveConfig, pveCreds, fetchFn)) as {
        vmid: number;
        node: string;
        disks: Array<{ key: string; storage: string; size: string }>;
        warnings: string[];
      };

      expect(result.vmid).toBe(100);
      expect(result.node).toBe('pve01');
      expect(result.disks).toHaveLength(1);
      expect(result.disks[0]?.storage).toBe('local-lvm');
      expect(result.disks[0]?.size).toBe('32G');
      expect(result.warnings).toContain(
        'Disk scsi0 uses local storage (local-lvm) — not shared for HA',
      );
    });

    it('uses provided node without resolving', async () => {
      const fetchFn = mockPveResponse({
        data: { name: 'web-01', memory: 4096 },
      });

      const result = (await handler('vm.config')(
        { vmid: 100, node: 'pve01' },
        pveConfig,
        pveCreds,
        fetchFn,
      )) as { node: string };

      expect(result.node).toBe('pve01');
      // Only 1 call (no resolveNode)
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('vm.snapshots', () => {
    it('returns snapshots and filters "current"', async () => {
      const now = Math.floor(Date.now() / 1000);
      const fetchFn = mockPveResponse({
        data: [
          { name: 'current', description: 'You are here!' },
          {
            name: 'pre-upgrade',
            description: 'Before upgrade',
            snaptime: now - 3600,
            parent: 'current',
          },
        ],
      });

      const result = (await handler('vm.snapshots')(
        { vmid: 100, node: 'pve01' },
        pveConfig,
        pveCreds,
        fetchFn,
      )) as {
        snapshots: Array<{ name: string }>;
        warnings: string[];
      };

      expect(result.snapshots).toHaveLength(1);
      expect(result.snapshots[0]?.name).toBe('pre-upgrade');
      expect(result.warnings).toHaveLength(0);
    });

    it('flags old snapshots', async () => {
      const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
      const fetchFn = mockPveResponse({
        data: [{ name: 'old-snap', description: 'Old one', snaptime: eightDaysAgo }],
      });

      const result = (await handler('vm.snapshots')(
        { vmid: 100, node: 'pve01' },
        pveConfig,
        pveCreds,
        fetchFn,
      )) as { warnings: string[] };

      expect(result.warnings.some((w: string) => w.includes('older than 7 days'))).toBe(true);
    });
  });

  describe('storage.content', () => {
    it('returns volumes', async () => {
      const fetchFn = mockPveResponse({
        data: [
          { volid: 'local-lvm:vm-100-disk-0', vmid: 100, size: 32e9, format: 'raw' },
          { volid: 'local-lvm:vm-101-disk-0', vmid: 101, size: 64e9, format: 'raw' },
        ],
      });

      const result = (await handler('storage.content')(
        { node: 'pve01', storage: 'local-lvm' },
        pveConfig,
        pveCreds,
        fetchFn,
      )) as { volumes: unknown[]; count: number };

      expect(result.count).toBe(2);
    });

    it('filters by vmid', async () => {
      const fetchFn = mockPveResponse({
        data: [
          { volid: 'local-lvm:vm-100-disk-0', vmid: 100, size: 32e9 },
          { volid: 'local-lvm:vm-101-disk-0', vmid: 101, size: 64e9 },
        ],
      });

      const result = (await handler('storage.content')(
        { node: 'pve01', storage: 'local-lvm', vmid: 100 },
        pveConfig,
        pveCreds,
        fetchFn,
      )) as { count: number };

      expect(result.count).toBe(1);
    });

    it('requires node and storage', async () => {
      const fetchFn = mockPveResponse({});
      await expect(handler('storage.content')({}, pveConfig, pveCreds, fetchFn)).rejects.toThrow(
        'node parameter is required',
      );

      await expect(
        handler('storage.content')({ node: 'pve01' }, pveConfig, pveCreds, fetchFn),
      ).rejects.toThrow('storage parameter is required');
    });
  });

  describe('cluster.tasks', () => {
    it('returns tasks', async () => {
      const fetchFn = mockPveResponse({
        data: [
          {
            upid: 'UPID:pve01:001',
            type: 'qmstart',
            status: 'OK',
            starttime: 1000,
            endtime: 1010,
            node: 'pve01',
            user: 'root@pam',
            id: '100',
          },
        ],
      });

      const result = (await handler('cluster.tasks')({}, pveConfig, pveCreds, fetchFn)) as {
        tasks: Array<{ type: string }>;
        warnings: string[];
      };

      expect(result.tasks).toHaveLength(1);
      expect(result.warnings).toHaveLength(0);
    });

    it('filters by vmid', async () => {
      const fetchFn = mockPveResponse({
        data: [
          { upid: 'UPID:1', type: 'qmstart', status: 'OK', node: 'pve01', id: '100', endtime: 1 },
          { upid: 'UPID:2', type: 'qmstart', status: 'OK', node: 'pve01', id: '101', endtime: 2 },
        ],
      });

      const result = (await handler('cluster.tasks')(
        { vmid: 100 },
        pveConfig,
        pveCreds,
        fetchFn,
      )) as { tasks: unknown[] };

      expect(result.tasks).toHaveLength(1);
    });

    it('flags failed tasks and running migrations', async () => {
      const fetchFn = mockPveResponse({
        data: [
          {
            upid: 'UPID:1',
            type: 'qmstart',
            status: 'WARNINGS: something',
            node: 'pve01',
            endtime: 1,
          },
          { upid: 'UPID:2', type: 'qmigrate', status: '', node: 'pve02' },
        ],
      });

      const result = (await handler('cluster.tasks')({}, pveConfig, pveCreds, fetchFn)) as {
        warnings: string[];
      };

      expect(result.warnings.some((w: string) => w.includes('failed'))).toBe(true);
      expect(result.warnings.some((w: string) => w.includes('Migration in progress'))).toBe(true);
    });
  });

  describe('node.lvm', () => {
    it('returns volume groups', async () => {
      const fetchFn = mockPveResponse({
        data: [{ name: 'pve', size: 500e9, free: 200e9, pvs: 1, lvs: 3 }],
      });

      const result = (await handler('node.lvm')(
        { node: 'pve01' },
        pveConfig,
        pveCreds,
        fetchFn,
      )) as {
        volumeGroups: Array<{ name: string }>;
        warnings: string[];
      };

      expect(result.volumeGroups).toHaveLength(1);
      expect(result.warnings).toHaveLength(0);
    });

    it('flags VGs with no free space', async () => {
      const fetchFn = mockPveResponse({
        data: [{ name: 'pve', size: 500e9, free: 0, pvs: 1, lvs: 5 }],
      });

      const result = (await handler('node.lvm')(
        { node: 'pve01' },
        pveConfig,
        pveCreds,
        fetchFn,
      )) as {
        warnings: string[];
      };

      expect(result.warnings).toContain('Volume group pve has no free space');
    });

    it('requires node parameter', async () => {
      const fetchFn = mockPveResponse({});
      await expect(handler('node.lvm')({}, pveConfig, pveCreds, fetchFn)).rejects.toThrow(
        'node parameter is required',
      );
    });
  });

  describe('lxc.status', () => {
    it('returns container status', async () => {
      // resolveNode call
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ data: [{ vmid: 200, node: 'pve02', type: 'lxc' }] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                vmid: 200,
                name: 'ct-nginx',
                status: 'running',
                uptime: 7200,
                cpu: 0.05,
                mem: 256e6,
                maxmem: 512e6,
                disk: 1e9,
                maxdisk: 8e9,
                swap: 0,
                maxswap: 512e6,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      const result = (await handler('lxc.status')({ vmid: 200 }, pveConfig, pveCreds, fetchFn)) as {
        vmid: number;
        name: string;
        status: string;
        node: string;
        warnings: string[];
      };

      expect(result.vmid).toBe(200);
      expect(result.name).toBe('ct-nginx');
      expect(result.node).toBe('pve02');
      expect(result.warnings).toHaveLength(0);
    });

    it('rejects qemu VMID', async () => {
      const fetchFn = mockPveResponse({
        data: [{ vmid: 100, node: 'pve01', type: 'qemu' }],
      });

      await expect(
        handler('lxc.status')({ vmid: 100 }, pveConfig, pveCreds, fetchFn),
      ).rejects.toThrow('not an LXC container');
    });
  });

  describe('lxc.config', () => {
    it('parses rootfs and mountpoints', async () => {
      const fetchFn = mockPveResponse({
        data: {
          hostname: 'ct-nginx',
          rootfs: 'local-lvm:subvol-200-disk-0,size=8G',
          mp0: 'local-lvm:subvol-200-disk-1,mp=/data,size=20G',
          cores: 2,
          memory: 512,
        },
      });

      const result = (await handler('lxc.config')(
        { vmid: 200, node: 'pve02' },
        pveConfig,
        pveCreds,
        fetchFn,
      )) as {
        rootfs: { storage: string; size: string };
        mountpoints: Array<{ key: string; storage: string; mountpoint: string; size: string }>;
      };

      expect(result.rootfs).toEqual({ storage: 'local-lvm', size: '8G' });
      expect(result.mountpoints).toHaveLength(1);
      expect(result.mountpoints[0]?.mountpoint).toBe('/data');
      expect(result.mountpoints[0]?.size).toBe('20G');
    });
  });

  describe('ceph.status', () => {
    it('returns ceph health and OSDs', async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // /cluster/ceph/status
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: {
                  health: { status: 'HEALTH_OK' },
                  osdmap: { osdmap: { num_osds: 6, num_up_osds: 6, num_in_osds: 6 } },
                  pgmap: {
                    pgs_by_state: [{ state_name: 'active+clean', count: 256 }],
                    bytes_total: 6e12,
                    bytes_used: 2e12,
                    bytes_avail: 4e12,
                  },
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        if (callCount === 2) {
          // /nodes
          return Promise.resolve(
            new Response(JSON.stringify({ data: [{ node: 'pve01', status: 'online' }] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        // /nodes/pve01/ceph/osd
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                { id: 0, name: 'osd.0', up: 1 },
                { id: 1, name: 'osd.1', up: 1 },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      const result = (await handler('ceph.status')({}, pveConfig, pveCreds, fetchFn)) as {
        available: boolean;
        health: string;
        osdCount: number;
        osdUp: number;
        osds: Array<{ id: number; status: string }>;
        warnings: string[];
      };

      expect(result.available).toBe(true);
      expect(result.health).toBe('HEALTH_OK');
      expect(result.osdCount).toBe(6);
      expect(result.osds).toHaveLength(2);
      expect(result.warnings).toHaveLength(0);
    });

    it('handles degraded ceph', async () => {
      const fetchFn = vi.fn().mockImplementation(() => {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                health: { status: 'HEALTH_WARN' },
                osdmap: { osdmap: { num_osds: 6, num_up_osds: 4, num_in_osds: 6 } },
                pgmap: { bytes_total: 6e12, bytes_used: 2e12, bytes_avail: 4e12 },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      const result = (await handler('ceph.status')({}, pveConfig, pveCreds, fetchFn)) as {
        warnings: string[];
      };

      expect(result.warnings.some((w: string) => w.includes('HEALTH_WARN'))).toBe(true);
      expect(result.warnings.some((w: string) => w.includes('2 OSD(s) down'))).toBe(true);
    });

    it('handles no ceph (404)', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValue(new Response('Not Found', { status: 404, statusText: 'Not Found' }));

      const result = (await handler('ceph.status')({}, pveConfig, pveCreds, fetchFn)) as {
        available: boolean;
        warnings: string[];
      };

      expect(result.available).toBe(false);
      expect(result.warnings).toContain('Ceph is not configured on this cluster');
    });
  });

  describe('cluster.resources', () => {
    it('returns all VMs and containers', async () => {
      const fetchFn = mockPveResponse({
        data: [
          {
            vmid: 100,
            name: 'web-01',
            node: 'pve01',
            type: 'qemu',
            status: 'running',
            uptime: 3600,
            cpu: 0.1,
            mem: 2e9,
            maxmem: 4e9,
          },
          {
            vmid: 200,
            name: 'ct-db',
            node: 'pve02',
            type: 'lxc',
            status: 'running',
            uptime: 7200,
            cpu: 0.05,
            mem: 512e6,
            maxmem: 1e9,
          },
          { vmid: 101, name: 'stopped-vm', node: 'pve01', type: 'qemu', status: 'stopped' },
        ],
      });

      const result = (await handler('cluster.resources')({}, pveConfig, pveCreds, fetchFn)) as {
        resources: Array<{
          vmid: number;
          name: string | null;
          node: string;
          type: string;
          status: string;
        }>;
      };

      expect(result.resources).toHaveLength(3);
      expect(result.resources[0]?.vmid).toBe(100);
      expect(result.resources[0]?.type).toBe('qemu');
      expect(result.resources[1]?.type).toBe('lxc');
    });

    it('calls /cluster/resources?type=vm', async () => {
      const fetchFn = mockPveResponse({ data: [] });
      await handler('cluster.resources')({}, pveConfig, pveCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/cluster/resources');
      expect(url).toContain('type=vm');
    });
  });

  describe('manifest', () => {
    it('has correct name and 14 probes', () => {
      expect(proxmoxPack.manifest.name).toBe('proxmox');
      expect(proxmoxPack.manifest.probes).toHaveLength(14);
    });

    it('all handlers match manifest probes', () => {
      const probeNames = proxmoxPack.manifest.probes.map((p) => p.name);
      const handlerNames = Object.keys(proxmoxPack.handlers);
      expect(handlerNames.sort()).toEqual(probeNames.sort());
    });

    it('has correct timeouts (30s for ceph, 15s for others)', () => {
      const probeMap = new Map(proxmoxPack.manifest.probes.map((p) => [p.name, p.timeout]));
      expect(probeMap.get('ceph.status')).toBe(30000);
      for (const [name, timeout] of probeMap) {
        if (name !== 'ceph.status') {
          expect(timeout).toBe(15000);
        }
      }
    });

    it('has virtualization runbook', () => {
      expect(proxmoxPack.manifest.runbook).toEqual({
        category: 'virtualization',
        probes: ['cluster.status', 'nodes.list', 'ceph.status'],
        parallel: true,
      });
    });
  });

  describe('error handling', () => {
    it('throws on non-200 API response for probes', async () => {
      const fetchFn = mockFetchError(403);
      await expect(handler('nodes.list')({}, pveConfig, pveCreds, fetchFn)).rejects.toThrow(
        'Proxmox API returned 403',
      );
    });
  });
});
