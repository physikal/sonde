import type { ProbeHandler } from '../../types.js';

export interface DiskEntry {
  key: string;
  storage: string;
  volume: string;
  format: string;
  size: string;
}

export interface VmConfigResult {
  vmid: number;
  config: Record<string, string>;
  disks: DiskEntry[];
  warnings: string[];
}

/**
 * Runs `qm config {vmid}` and parses key: value output.
 * Identifies disk backends (scsi, ide, virtio, sata, efidisk).
 */
export const vmConfig: ProbeHandler = async (params, exec) => {
  const vmid = params?.vmid as number;
  if (vmid == null) throw new Error('vmid parameter is required');

  const stdout = await exec('qm', ['config', String(vmid)]);
  return parseVmConfig(stdout, vmid);
};

export function parseVmConfig(stdout: string, vmid: number): VmConfigResult {
  const config: Record<string, string> = {};
  const lines = stdout.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    config[key] = value;
  }

  const diskPrefixes = ['scsi', 'ide', 'virtio', 'sata', 'efidisk', 'tpmstate'];
  const disks: DiskEntry[] = [];
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(config)) {
    const matchesDisk = diskPrefixes.some((p) => key.startsWith(p));
    if (!matchesDisk) continue;

    const colonIdx = value.indexOf(':');
    if (colonIdx === -1) continue;

    const storage = value.slice(0, colonIdx);
    const rest = value.slice(colonIdx + 1);
    const commaIdx = rest.indexOf(',');
    const volume = commaIdx > -1 ? rest.slice(0, commaIdx) : rest;
    const optsPart = commaIdx > -1 ? rest.slice(commaIdx + 1) : '';

    let format = 'raw';
    if (volume.endsWith('.qcow2')) format = 'qcow2';
    else if (volume.endsWith('.vmdk')) format = 'vmdk';
    else if (optsPart.includes('format=qcow2')) format = 'qcow2';
    else if (optsPart.includes('format=vmdk')) format = 'vmdk';
    else if (optsPart.includes('format=raw')) format = 'raw';

    const sizeMatch = optsPart.match(/size=(\S+)/);
    const size = sizeMatch?.[1] ?? '';

    disks.push({ key, storage, volume, format, size });

    if (storage === 'local' || storage === 'local-lvm') {
      warnings.push(`Disk ${key} uses local storage (${storage})`);
    }
  }

  return { vmid, config, disks, warnings };
}
