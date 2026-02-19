import type { PackManifest } from '@sonde/shared';

export const redisManifest: PackManifest = {
  name: 'redis',
  version: '0.1.0',
  description: 'Redis probes: server info, key count, memory usage',
  requires: {
    groups: [],
    files: [],
    commands: ['redis-cli'],
  },
  probes: [
    {
      name: 'info',
      description: 'Get Redis server info (version, uptime, clients, memory)',
      capability: 'observe',
      params: {
        host: { type: 'string', description: 'Redis host', required: false, default: '127.0.0.1' },
        port: { type: 'number', description: 'Redis port', required: false, default: 6379 },
      },
      timeout: 10_000,
    },
    {
      name: 'keys.count',
      description: 'Count keys per database',
      capability: 'observe',
      params: {
        host: { type: 'string', description: 'Redis host', required: false, default: '127.0.0.1' },
        port: { type: 'number', description: 'Redis port', required: false, default: 6379 },
      },
      timeout: 10_000,
    },
    {
      name: 'memory.usage',
      description: 'Get Redis memory usage statistics',
      capability: 'observe',
      params: {
        host: { type: 'string', description: 'Redis host', required: false, default: '127.0.0.1' },
        port: { type: 'number', description: 'Redis port', required: false, default: 6379 },
      },
      timeout: 10_000,
    },
  ],
  runbook: {
    category: 'redis',
    probes: ['info', 'memory.usage', 'keys.count'],
    parallel: true,
  },
  detect: {
    commands: ['redis-cli'],
  },
};
