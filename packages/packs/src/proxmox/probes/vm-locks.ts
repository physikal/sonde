import type { ProbeHandler } from '../../types.js';

export interface VmLock {
  vmid: number;
  file: string;
}

export interface VmLocksResult {
  locks: VmLock[];
  warnings: string[];
}

/**
 * Lists files in /run/lock/qemu-server/ to find locked VMs.
 * Lock files are named like "lock-100.conf".
 */
export const vmLocks: ProbeHandler = async (_params, exec) => {
  let stdout: string;
  try {
    stdout = await exec('ls', ['/run/lock/qemu-server/']);
  } catch {
    // Directory may not exist or be empty
    return { locks: [], warnings: [] };
  }
  return parseVmLocks(stdout);
};

export function parseVmLocks(stdout: string): VmLocksResult {
  const files = stdout.trim().split('\n').filter(Boolean);
  const locks: VmLock[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    // Lock files are typically "lock-{vmid}.conf"
    const match = file.match(/lock-(\d+)\.conf/);
    if (match) {
      const vmid = Number.parseInt(match[1] ?? '', 10);
      if (!Number.isNaN(vmid)) {
        locks.push({ vmid, file });
      }
    }
  }

  if (locks.length > 0) {
    warnings.push(`${locks.length} VM(s) locked: ${locks.map((l) => l.vmid).join(', ')}`);
  }

  return { locks, warnings };
}
