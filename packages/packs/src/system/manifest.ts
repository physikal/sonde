import type { PackManifest } from '@sonde/shared';

export const systemManifest: PackManifest = {
  name: 'system',
  version: '0.2.0',
  description:
    'System metrics, logs, and network diagnostics: disk, memory, CPU, journal, dmesg, log tail, ping, traceroute',
  requires: {
    groups: [],
    files: [],
    commands: [
      'df',
      'ping',
      'journalctl',
      'dmesg',
      'tail',
      'traceroute',
    ],
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
    {
      name: 'logs.journal',
      description:
        'Recent systemd journal entries (Linux only)',
      capability: 'observe',
      timeout: 15_000,
      params: {
        unit: {
          type: 'string',
          description:
            'Filter to a specific systemd unit (e.g. "nginx")',
          required: false,
        },
        lines: {
          type: 'number',
          description:
            'Number of entries to return (default 50, max 500)',
          required: false,
        },
        priority: {
          type: 'string',
          description:
            'Syslog priority filter (e.g. "err", "warning")',
          required: false,
        },
      },
    },
    {
      name: 'logs.dmesg',
      description: 'Kernel ring buffer (dmesg) output',
      capability: 'observe',
      timeout: 10_000,
      params: {
        lines: {
          type: 'number',
          description:
            'Number of lines to return (default 50, max 500)',
          required: false,
        },
      },
    },
    {
      name: 'logs.tail',
      description:
        'Tail a log file (restricted to /var/log/ and /tmp/)',
      capability: 'observe',
      timeout: 10_000,
      params: {
        path: {
          type: 'string',
          description:
            'Absolute path to log file (must be under /var/log/ or /tmp/)',
          required: true,
        },
        lines: {
          type: 'number',
          description:
            'Number of lines to return (default 50, max 500)',
          required: false,
        },
      },
    },
    {
      name: 'network.traceroute',
      description:
        'Trace network path to a host showing each hop and latency',
      capability: 'observe',
      timeout: 60_000,
      params: {
        host: {
          type: 'string',
          description: 'Hostname or IP address to trace',
          required: true,
        },
        maxHops: {
          type: 'number',
          description:
            'Maximum number of hops (default 30, max 64)',
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
