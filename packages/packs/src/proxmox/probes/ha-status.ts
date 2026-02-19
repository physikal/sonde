import type { ProbeHandler } from '../../types.js';

export interface HaResource {
  sid: string;
  state: string;
  node: string;
  request: string;
}

export interface HaStatusResult {
  resources: HaResource[];
  warnings: string[];
}

/**
 * Runs `ha-manager status` and parses the output.
 * Format: "quorum OK\nsid state node request\n..."
 */
export const haStatus: ProbeHandler = async (_params, exec) => {
  const stdout = await exec('ha-manager', ['status']);
  return parseHaStatus(stdout);
};

export function parseHaStatus(stdout: string): HaStatusResult {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const resources: HaResource[] = [];
  const warnings: string[] = [];

  for (const line of lines) {
    // Skip header/quorum lines
    if (line.startsWith('quorum') || line.startsWith('master')) continue;

    // Resource lines: "vm:100 started pve01 none"
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;

    const sid = parts[0] ?? '';
    // Skip if it doesn't look like a resource SID (e.g. vm:100, ct:200)
    if (!sid.includes(':')) continue;

    const state = parts[1] ?? '';
    const node = parts[2] ?? '';
    const request = parts[3] ?? 'none';

    resources.push({ sid, state, node, request });

    if (state === 'error' || state === 'fence') {
      warnings.push(`HA resource ${sid} in ${state} state on ${node}`);
    }
    if (state === 'stopped') {
      warnings.push(`HA resource ${sid} is stopped`);
    }
  }

  return { resources, warnings };
}
