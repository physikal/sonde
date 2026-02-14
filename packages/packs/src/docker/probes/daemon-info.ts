import type { ProbeHandler } from '../../types.js';

export interface DaemonInfoResult {
  serverVersion: string;
  containers: number;
  images: number;
  driver: string;
  os: string;
  memoryBytes: number;
  cpus: number;
}

/**
 * Runs `docker info --format json` and extracts key daemon info.
 */
export const daemonInfo: ProbeHandler = async (_params, exec) => {
  const stdout = await exec('docker', ['info', '--format', 'json']);
  return parseDaemonInfo(stdout);
};

export function parseDaemonInfo(stdout: string): DaemonInfoResult {
  const raw = JSON.parse(stdout);

  return {
    serverVersion: raw.ServerVersion ?? '',
    containers: raw.Containers ?? 0,
    images: raw.Images ?? 0,
    driver: raw.Driver ?? '',
    os: raw.OperatingSystem ?? '',
    memoryBytes: raw.MemTotal ?? 0,
    cpus: raw.NCPU ?? 0,
  };
}
