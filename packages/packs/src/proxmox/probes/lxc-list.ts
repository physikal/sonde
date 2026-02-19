import type { ProbeHandler } from '../../types.js';

export interface LxcContainer {
  vmid: number;
  status: string;
  lock: string;
  name: string;
}

export interface LxcListResult {
  containers: LxcContainer[];
}

/**
 * Runs `pct list` and parses the tabular output.
 * Format:
 *   VMID       Status     Lock         Name
 *   200        running                 ct-nginx
 *   201        stopped    backup       ct-db
 */
export const lxcList: ProbeHandler = async (_params, exec) => {
  const stdout = await exec('pct', ['list']);
  return parseLxcList(stdout);
};

export function parseLxcList(stdout: string): LxcListResult {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const containers: LxcContainer[] = [];

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.trim().split(/\s+/);

    // "VMID Status Lock Name" — but Lock may be empty
    // With lock: "200 running backup ct-nginx" (4 parts)
    // Without lock: "200 running ct-nginx" (3 parts, lock column is blank)

    // pct list uses fixed-width columns. Parse by position.
    // VMID is first number, Status is second word.
    // If there are 4+ parts and part[2] looks like a lock (not a hostname), it's a lock.
    const vmid = Number.parseInt(parts[0] ?? '', 10);
    if (Number.isNaN(vmid)) continue;

    const status = parts[1] ?? '';

    // Determine if part[2] is a lock or the name.
    // Lock values are: backup, snapshot, suspended, migrate, etc.
    // Names are typically longer/different. But the safest approach:
    // If there are 4+ parts, the 3rd is lock and 4th+ is name.
    // If there are 3 parts, lock is empty and 3rd is name.
    let lock = '';
    let name = '';

    if (parts.length >= 4) {
      lock = parts[2] ?? '';
      name = parts.slice(3).join(' ');
    } else if (parts.length === 3) {
      name = parts[2] ?? '';
    }

    containers.push({ vmid, status, lock, name });
  }

  return { containers };
}
