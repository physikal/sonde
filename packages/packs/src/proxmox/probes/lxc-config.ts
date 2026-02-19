import type { ProbeHandler } from '../../types.js';

export interface LxcMountpoint {
  key: string;
  storage: string;
  volume: string;
  mountpoint: string;
  size: string;
}

export interface LxcConfigResult {
  vmid: number;
  config: Record<string, string>;
  rootfs: { storage: string; size: string } | null;
  mountpoints: LxcMountpoint[];
  network: Array<{ key: string; raw: string }>;
  warnings: string[];
}

/**
 * Runs `pct config {vmid}` and parses key: value output.
 * Identifies rootfs storage, mountpoints, network config.
 */
export const lxcConfig: ProbeHandler = async (params, exec) => {
  const vmid = params?.vmid as number;
  if (vmid == null) throw new Error('vmid parameter is required');

  const stdout = await exec('pct', ['config', String(vmid)]);
  return parseLxcConfig(stdout, vmid);
};

export function parseLxcConfig(stdout: string, vmid: number): LxcConfigResult {
  const config: Record<string, string> = {};
  const lines = stdout.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    config[key] = value;
  }

  // Parse rootfs: "local-lvm:subvol-200-disk-0,size=8G"
  let rootfs: { storage: string; size: string } | null = null;
  if (config.rootfs) {
    const colonIdx = config.rootfs.indexOf(':');
    if (colonIdx > -1) {
      const storage = config.rootfs.slice(0, colonIdx);
      const rest = config.rootfs.slice(colonIdx + 1);
      const sizeMatch = rest.match(/size=(\S+)/);
      rootfs = { storage, size: sizeMatch?.[1] ?? '' };
    }
  }

  // Parse mp0–mp255 mountpoints
  const mountpoints: LxcMountpoint[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (!/^mp\d+$/.test(key)) continue;
    const colonIdx = value.indexOf(':');
    if (colonIdx === -1) continue;

    const storage = value.slice(0, colonIdx);
    const rest = value.slice(colonIdx + 1);
    const commaIdx = rest.indexOf(',');
    const volume = commaIdx > -1 ? rest.slice(0, commaIdx) : rest;
    const optsPart = commaIdx > -1 ? rest.slice(commaIdx + 1) : '';

    const mpMatch = optsPart.match(/mp=([^,]+)/);
    const sizeMatch = optsPart.match(/size=(\S+)/);
    mountpoints.push({
      key,
      storage,
      volume,
      mountpoint: mpMatch?.[1] ?? '',
      size: sizeMatch?.[1] ?? '',
    });
  }

  // Parse network interfaces
  const network: Array<{ key: string; raw: string }> = [];
  for (const [key, value] of Object.entries(config)) {
    if (/^net\d+$/.test(key)) {
      network.push({ key, raw: value });
    }
  }

  const warnings: string[] = [];
  return { vmid, config, rootfs, mountpoints, network, warnings };
}
