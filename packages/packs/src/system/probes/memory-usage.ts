import type { ProbeHandler } from '../../types.js';

export interface MemoryUsageResult {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  availableBytes: number;
  swap: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
  };
}

/**
 * Runs `free -b` and parses the output into structured JSON.
 * `-b` = output in bytes.
 */
export const memoryUsage: ProbeHandler = async (_params, exec) => {
  const stdout = await exec('free', ['-b']);
  return parseFreeOutput(stdout);
};

export function parseFreeOutput(stdout: string): MemoryUsageResult {
  const lines = stdout.trim().split('\n');

  let totalBytes = 0;
  let usedBytes = 0;
  let freeBytes = 0;
  let availableBytes = 0;
  let swapTotal = 0;
  let swapUsed = 0;
  let swapFree = 0;

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const label = parts[0]?.toLowerCase();

    if (label === 'mem:') {
      totalBytes = Number(parts[1]);
      usedBytes = Number(parts[2]);
      freeBytes = Number(parts[3]);
      // "available" is the last column in modern `free` output
      availableBytes = Number(parts[parts.length - 1]);
    } else if (label === 'swap:') {
      swapTotal = Number(parts[1]);
      swapUsed = Number(parts[2]);
      swapFree = Number(parts[3]);
    }
  }

  return {
    totalBytes,
    usedBytes,
    freeBytes,
    availableBytes,
    swap: {
      totalBytes: swapTotal,
      usedBytes: swapUsed,
      freeBytes: swapFree,
    },
  };
}
