import type { ProbeHandler } from '../../types.js';

export interface OsdNode {
  id: number;
  name: string;
  type: string;
  status: string;
  crush_weight: number;
  reweight: number;
  host: string;
}

export interface CephStatusResult {
  available: boolean;
  health: string;
  osdCount: number;
  osdUp: number;
  osdIn: number;
  pgStates: Array<{ state: string; count: number }>;
  usage: { total: number; used: number; avail: number };
  osds: OsdNode[];
  warnings: string[];
}

/**
 * Runs `ceph status --format json` and `ceph osd tree --format json`.
 * Gracefully handles missing ceph binary.
 */
export const cephStatus: ProbeHandler = async (_params, exec) => {
  let statusOut: string;
  try {
    statusOut = await exec('ceph', ['status', '--format', 'json']);
  } catch {
    return {
      available: false,
      health: null,
      warnings: ['Ceph is not installed or not accessible on this node'],
    };
  }

  return parseCephStatus(statusOut, exec);
};

export async function parseCephStatus(
  statusOut: string,
  exec?: (cmd: string, args: string[]) => Promise<string>,
): Promise<CephStatusResult> {
  const data = JSON.parse(statusOut);
  const warnings: string[] = [];

  const health = data.health?.status ?? 'unknown';
  const osdmap = data.osdmap ?? {};
  const osdCount = osdmap.num_osds ?? 0;
  const osdUp = osdmap.num_up_osds ?? 0;
  const osdIn = osdmap.num_in_osds ?? 0;

  if (health !== 'HEALTH_OK') {
    warnings.push(`Ceph health: ${health}`);
  }
  if (osdCount > 0 && osdUp < osdCount) {
    warnings.push(`${osdCount - osdUp} OSD(s) down`);
  }

  const pgmap = data.pgmap ?? {};
  const pgStates: Array<{ state: string; count: number }> = (pgmap.pgs_by_state ?? []).map(
    (p: { state_name?: string; count?: number }) => ({
      state: p.state_name ?? '',
      count: p.count ?? 0,
    }),
  );

  const usage = {
    total: pgmap.bytes_total ?? 0,
    used: pgmap.bytes_used ?? 0,
    avail: pgmap.bytes_avail ?? 0,
  };

  // OSD tree for placement info
  let osds: OsdNode[] = [];
  if (exec) {
    try {
      const treeOut = await exec('ceph', ['osd', 'tree', '--format', 'json']);
      osds = parseOsdTree(treeOut);
    } catch {
      // OSD tree is best-effort
    }
  }

  return { available: true, health, osdCount, osdUp, osdIn, pgStates, usage, osds, warnings };
}

export function parseOsdTree(stdout: string): OsdNode[] {
  const data = JSON.parse(stdout);
  const nodes = data.nodes ?? [];
  return nodes
    .filter((n: { type?: string }) => n.type === 'osd')
    .map(
      (n: {
        id?: number;
        name?: string;
        type?: string;
        status?: string;
        crush_weight?: number;
        reweight?: number;
        host?: string;
      }) => ({
        id: n.id ?? 0,
        name: n.name ?? '',
        type: n.type ?? 'osd',
        status: n.status ?? 'unknown',
        crush_weight: n.crush_weight ?? 0,
        reweight: n.reweight ?? 0,
        host: n.host ?? '',
      }),
    );
}
