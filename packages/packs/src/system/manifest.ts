import type { PackManifest } from '@sonde/shared';

export const systemManifest: PackManifest = {
  name: 'system',
  version: '0.1.0',
  description: 'Basic system metrics: disk usage, memory usage, CPU load',
  requires: {
    groups: [],
    files: [],
    commands: ['df', 'ping'],
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
    {
      name: 'network.ping',
      description:
        'Ping a remote host to test ICMP reachability and measure latency',
      capability: 'observe',
      timeout: 20_000,
      params: {
        host: {
          type: 'string',
          description: 'Hostname or IP address to ping',
          required: true,
        },
        count: {
          type: 'number',
          description:
            'Number of ping packets to send (default 4, max 20)',
          required: false,
        },
      },
    },
  ],
  runbook: {
    category: 'system',
    probes: ['disk.usage', 'memory.usage', 'cpu.usage'],
    parallel: true,
  },
  detect: {
    files: ['/proc/loadavg'],
  },
};
