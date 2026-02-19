import type { ProbeHandler } from '../../types.js';

export interface LogicalVolume {
  name: string;
  vgName: string;
  size: string;
  attrs: string;
  pool: string;
  dataPercent: string;
}

export interface VolumeGroup {
  name: string;
  size: string;
  free: string;
  pvCount: number;
  lvCount: number;
}

export interface PhysicalVolume {
  name: string;
  vgName: string;
  size: string;
  free: string;
  format: string;
}

export interface LvmResult {
  logicalVolumes: LogicalVolume[];
  volumeGroups: VolumeGroup[];
  physicalVolumes: PhysicalVolume[];
  warnings: string[];
}

/**
 * Runs lvs, vgs, pvs with --reportformat json and returns structured LVM topology.
 */
export const lvm: ProbeHandler = async (_params, exec) => {
  const [lvsOut, vgsOut, pvsOut] = await Promise.all([
    exec('lvs', [
      '--reportformat',
      'json',
      '--units',
      'b',
      '-o',
      'lv_name,vg_name,lv_size,lv_attr,pool_lv,data_percent',
    ]),
    exec('vgs', [
      '--reportformat',
      'json',
      '--units',
      'b',
      '-o',
      'vg_name,vg_size,vg_free,pv_count,lv_count',
    ]),
    exec('pvs', [
      '--reportformat',
      'json',
      '--units',
      'b',
      '-o',
      'pv_name,vg_name,pv_size,pv_free,pv_fmt',
    ]),
  ]);
  return parseLvm(lvsOut, vgsOut, pvsOut);
};

export function parseLvm(lvsOut: string, vgsOut: string, pvsOut: string): LvmResult {
  const warnings: string[] = [];

  const lvsData = JSON.parse(lvsOut);
  const logicalVolumes: LogicalVolume[] = (lvsData.report?.[0]?.lv ?? []).map(
    (lv: Record<string, string>) => ({
      name: lv.lv_name ?? '',
      vgName: lv.vg_name ?? '',
      size: lv.lv_size ?? '',
      attrs: lv.lv_attr ?? '',
      pool: lv.pool_lv ?? '',
      dataPercent: lv.data_percent ?? '',
    }),
  );

  const vgsData = JSON.parse(vgsOut);
  const volumeGroups: VolumeGroup[] = (vgsData.report?.[0]?.vg ?? []).map(
    (vg: Record<string, string>) => ({
      name: vg.vg_name ?? '',
      size: vg.vg_size ?? '',
      free: vg.vg_free ?? '',
      pvCount: Number(vg.pv_count ?? 0),
      lvCount: Number(vg.lv_count ?? 0),
    }),
  );

  const pvsData = JSON.parse(pvsOut);
  const physicalVolumes: PhysicalVolume[] = (pvsData.report?.[0]?.pv ?? []).map(
    (pv: Record<string, string>) => ({
      name: pv.pv_name ?? '',
      vgName: pv.vg_name ?? '',
      size: pv.pv_size ?? '',
      free: pv.pv_free ?? '',
      format: pv.pv_fmt ?? '',
    }),
  );

  // Flag thin pools with high usage
  for (const lv of logicalVolumes) {
    if (lv.dataPercent && Number.parseFloat(lv.dataPercent) > 85) {
      warnings.push(`Thin pool ${lv.name} is ${lv.dataPercent}% used`);
    }
  }

  // Flag VGs with no free space
  for (const vg of volumeGroups) {
    const freeBytes = Number.parseInt(vg.free, 10);
    if (!Number.isNaN(freeBytes) && freeBytes === 0) {
      warnings.push(`Volume group ${vg.name} has no free space`);
    }
  }

  return { logicalVolumes, volumeGroups, physicalVolumes, warnings };
}
