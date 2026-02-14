import type { PackManifest } from '@sonde/shared';

export const systemManifest: PackManifest = {
  name: 'system',
  version: '0.1.0',
  description: 'Basic system metrics: disk usage, memory usage, CPU load',
  requires: {
    groups: [],
    files: [],
    commands: ['df'],
  },
  probes: [
    {
      name: 'disk.usage',
      description: 'Disk usage per mounted filesystem',
      capability: 'observe',
      timeout: 10_000,
    },
    {
      name: 'memory.usage',
      description: 'System memory and swap usage',
      capability: 'observe',
      timeout: 10_000,
    },
    {
      name: 'cpu.usage',
      description: 'CPU load averages and core count',
      capability: 'observe',
      timeout: 10_000,
    },
  ],
  detect: {
    files: ['/proc/loadavg'],
  },
};
