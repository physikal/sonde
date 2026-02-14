import type { ProbeHandler } from '../../types.js';

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
}

export interface ContainersListResult {
  containers: ContainerInfo[];
}

/**
 * Runs `docker ps -a --format json` and parses each JSON line.
 * The --format json flag outputs one JSON object per line (Docker 20.10+).
 */
export const containersList: ProbeHandler = async (_params, exec) => {
  const stdout = await exec('docker', ['ps', '-a', '--format', 'json']);
  return parseContainersList(stdout);
};

export function parseContainersList(stdout: string): ContainersListResult {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const containers: ContainerInfo[] = [];

  for (const line of lines) {
    const raw = JSON.parse(line);
    containers.push({
      id: raw.ID ?? '',
      name: raw.Names ?? '',
      image: raw.Image ?? '',
      state: raw.State ?? '',
      status: raw.Status ?? '',
      ports: raw.Ports ?? '',
    });
  }

  return { containers };
}
