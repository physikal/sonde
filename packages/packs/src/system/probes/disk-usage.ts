import type { ProbeHandler } from '../../types.js';

export interface FilesystemUsage {
  filesystem: string;
  sizeKb: number;
  usedKb: number;
  availableKb: number;
  usePct: number;
  mountedOn: string;
}

export interface DiskUsageResult {
  filesystems: FilesystemUsage[];
}

/**
 * Runs `df -kP` and parses the output into structured JSON.
 * `-k` = 1K blocks, `-P` = POSIX portable output format (one line per fs).
 */
export const diskUsage: ProbeHandler = async (_params, exec) => {
  const stdout = await exec('df', ['-kP']);
  return parseDfOutput(stdout);
};

export function parseDfOutput(stdout: string): DiskUsageResult {
  const lines = stdout.trim().split('\n');
  // Skip header line
  const dataLines = lines.slice(1);

  const filesystems: FilesystemUsage[] = [];

  for (const line of dataLines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;

    const [filesystem, sizeStr, usedStr, availStr, pctStr, mountedOn] = parts;
    if (!filesystem || !sizeStr || !usedStr || !availStr || !pctStr || !mountedOn) continue;

    // Skip pseudo-filesystems
    if (filesystem === 'tmpfs' || filesystem === 'devtmpfs' || filesystem === 'none') continue;

    const sizeKb = Number(sizeStr);
    const usedKb = Number(usedStr);
    const availableKb = Number(availStr);
    const usePct = Number.parseInt(pctStr.replace('%', ''), 10);

    if (Number.isNaN(sizeKb) || Number.isNaN(usedKb)) continue;

    filesystems.push({ filesystem, sizeKb, usedKb, availableKb, usePct, mountedOn });
  }

  return { filesystems };
}
