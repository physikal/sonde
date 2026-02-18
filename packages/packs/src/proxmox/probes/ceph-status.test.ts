import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { CephStatusResult } from './ceph-status.js';
import { cephStatus, parseOsdTree } from './ceph-status.js';

const CEPH_STATUS_JSON = JSON.stringify({
  health: { status: 'HEALTH_OK' },
  osdmap: { num_osds: 6, num_up_osds: 6, num_in_osds: 6 },
  pgmap: {
    pgs_by_state: [{ state_name: 'active+clean', count: 256 }],
    bytes_total: 6000000000000,
    bytes_used: 2000000000000,
    bytes_avail: 4000000000000,
  },
});

const OSD_TREE_JSON = JSON.stringify({
  nodes: [
    { id: -1, name: 'default', type: 'root' },
    { id: -2, name: 'pve01', type: 'host' },
    {
      id: 0,
      name: 'osd.0',
      type: 'osd',
      status: 'up',
      crush_weight: 1.0,
      reweight: 1.0,
      host: 'pve01',
    },
    {
      id: 1,
      name: 'osd.1',
      type: 'osd',
      status: 'up',
      crush_weight: 1.0,
      reweight: 1.0,
      host: 'pve01',
    },
    {
      id: 2,
      name: 'osd.2',
      type: 'osd',
      status: 'down',
      crush_weight: 1.0,
      reweight: 0,
      host: 'pve02',
    },
  ],
});

describe('cephStatus handler', () => {
  it('returns health, OSD counts, and PG states', async () => {
    let callCount = 0;
    const mockExec: ExecFn = async (cmd, args) => {
      callCount++;
      expect(cmd).toBe('ceph');
      if (callCount === 1) {
        expect(args).toEqual(['status', '--format', 'json']);
        return CEPH_STATUS_JSON;
      }
      expect(args).toEqual(['osd', 'tree', '--format', 'json']);
      return OSD_TREE_JSON;
    };

    const result = (await cephStatus(undefined, mockExec)) as CephStatusResult;
    expect(result.available).toBe(true);
    expect(result.health).toBe('HEALTH_OK');
    expect(result.osdCount).toBe(6);
    expect(result.osdUp).toBe(6);
    expect(result.osdIn).toBe(6);
    expect(result.pgStates).toHaveLength(1);
    expect(result.pgStates[0]).toEqual({ state: 'active+clean', count: 256 });
    expect(result.usage.total).toBe(6000000000000);
    expect(result.osds).toHaveLength(3);
    expect(result.warnings).toHaveLength(0);
  });

  it('flags degraded health', async () => {
    const degraded = JSON.stringify({
      health: { status: 'HEALTH_WARN' },
      osdmap: { num_osds: 6, num_up_osds: 4, num_in_osds: 6 },
      pgmap: { bytes_total: 0, bytes_used: 0, bytes_avail: 0 },
    });

    const mockExec: ExecFn = async (cmd, args) => {
      if (args[0] === 'status') return degraded;
      return '{"nodes":[]}';
    };

    const result = (await cephStatus(undefined, mockExec)) as CephStatusResult;
    expect(result.warnings.some((w) => w.includes('HEALTH_WARN'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('2 OSD(s) down'))).toBe(true);
  });

  it('handles missing ceph binary gracefully', async () => {
    const mockExec: ExecFn = async () => {
      throw new Error('command not found: ceph');
    };

    const result = (await cephStatus(undefined, mockExec)) as { available: boolean };
    expect(result.available).toBe(false);
  });
});

describe('parseOsdTree', () => {
  it('extracts only OSD nodes from the tree', () => {
    const osds = parseOsdTree(OSD_TREE_JSON);
    expect(osds).toHaveLength(3);
    expect(osds[0]).toEqual({
      id: 0,
      name: 'osd.0',
      type: 'osd',
      status: 'up',
      crush_weight: 1.0,
      reweight: 1.0,
      host: 'pve01',
    });
    expect(osds[2]?.status).toBe('down');
  });

  it('filters out non-OSD nodes', () => {
    const osds = parseOsdTree(OSD_TREE_JSON);
    const types = osds.map((o) => o.type);
    expect(types.every((t) => t === 'osd')).toBe(true);
  });
});
