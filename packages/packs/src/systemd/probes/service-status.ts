import type { ProbeHandler } from '../../types.js';

export interface ServiceStatusResult {
  name: string;
  loadState: string;
  activeState: string;
  subState: string;
  mainPid: number;
  memoryBytes: number;
  restartCount: number;
}

/**
 * Runs `systemctl show <service> --no-pager` and parses key=value output.
 */
export const serviceStatus: ProbeHandler = async (params, exec) => {
  const service = params?.service as string;
  const stdout = await exec('systemctl', ['show', service, '--no-pager']);
  return parseServiceStatus(stdout);
};

export function parseServiceStatus(stdout: string): ServiceStatusResult {
  const props = new Map<string, string>();

  for (const line of stdout.trim().split('\n')) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    props.set(key, value);
  }

  return {
    name: props.get('Id') ?? '',
    loadState: props.get('LoadState') ?? '',
    activeState: props.get('ActiveState') ?? '',
    subState: props.get('SubState') ?? '',
    mainPid: Number(props.get('MainPID') ?? '0'),
    memoryBytes: Number(props.get('MemoryCurrent') ?? '0'),
    restartCount: Number(props.get('NRestarts') ?? '0'),
  };
}
