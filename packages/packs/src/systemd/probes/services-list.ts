import type { ProbeHandler } from '../../types.js';

export interface ServiceInfo {
  unit: string;
  load: string;
  active: string;
  sub: string;
  description: string;
}

export interface ServicesListResult {
  services: ServiceInfo[];
}

/**
 * Runs `systemctl list-units --type=service --all --no-pager --output=json`
 * and parses the JSON output.
 */
export const servicesList: ProbeHandler = async (_params, exec) => {
  const stdout = await exec('systemctl', [
    'list-units',
    '--type=service',
    '--all',
    '--no-pager',
    '--output=json',
  ]);
  return parseServicesList(stdout);
};

export function parseServicesList(stdout: string): ServicesListResult {
  const raw = JSON.parse(stdout);
  const services: ServiceInfo[] = [];

  for (const entry of raw) {
    services.push({
      unit: entry.unit ?? '',
      load: entry.load ?? '',
      active: entry.active ?? '',
      sub: entry.sub ?? '',
      description: entry.description ?? '',
    });
  }

  return { services };
}
