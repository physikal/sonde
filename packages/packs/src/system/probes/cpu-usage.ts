import type { ProbeHandler } from '../../types.js';

export interface CpuUsageResult {
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  cpuCount: number;
}

/**
 * Reads /proc/loadavg for load averages and `nproc` for CPU count.
 * Returns load averages and core count so consumers can compute utilization.
 */
export const cpuUsage: ProbeHandler = async (_params, exec) => {
  const [loadAvgRaw, nprocRaw] = await Promise.all([
    exec('cat', ['/proc/loadavg']),
    exec('nproc', []),
  ]);
  return parseLoadAvg(loadAvgRaw, nprocRaw);
};

export function parseLoadAvg(loadAvgRaw: string, nprocRaw: string): CpuUsageResult {
  const parts = loadAvgRaw.trim().split(/\s+/);
  const loadAvg1 = Number(parts[0]);
  const loadAvg5 = Number(parts[1]);
  const loadAvg15 = Number(parts[2]);
  const cpuCount = Number.parseInt(nprocRaw.trim(), 10);

  return { loadAvg1, loadAvg5, loadAvg15, cpuCount };
}
