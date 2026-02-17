import type { PackManifest } from '@sonde/shared';

export const mysqlManifest: PackManifest = {
  name: 'mysql',
  version: '0.1.0',
  description: 'MySQL probes: database listing, process list, server status',
  requires: {
    groups: [],
    files: [],
    commands: ['mysql'],
  },
  probes: [
    {
      name: 'databases.list',
      description: 'List all MySQL databases with table counts and sizes',
      capability: 'observe',
      params: {
        host: { type: 'string', description: 'Database host', required: false, default: 'localhost' },
        port: { type: 'number', description: 'Database port', required: false, default: 3306 },
        user: { type: 'string', description: 'Database user', required: false, default: 'root' },
      },
      timeout: 15_000,
    },
    {
      name: 'processlist',
      description: 'Show active MySQL processes',
      capability: 'observe',
      params: {
        host: { type: 'string', description: 'Database host', required: false, default: 'localhost' },
        port: { type: 'number', description: 'Database port', required: false, default: 3306 },
        user: { type: 'string', description: 'Database user', required: false, default: 'root' },
      },
      timeout: 15_000,
    },
    {
      name: 'status',
      description: 'Get MySQL server status variables',
      capability: 'observe',
      params: {
        host: { type: 'string', description: 'Database host', required: false, default: 'localhost' },
        port: { type: 'number', description: 'Database port', required: false, default: 3306 },
        user: { type: 'string', description: 'Database user', required: false, default: 'root' },
      },
      timeout: 15_000,
    },
  ],
  runbook: {
    category: 'mysql',
    probes: ['databases.list', 'processlist', 'status'],
    parallel: true,
  },
  detect: {
    commands: ['mysql'],
  },
};
