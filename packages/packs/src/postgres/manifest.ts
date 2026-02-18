import type { PackManifest } from '@sonde/shared';

export const postgresManifest: PackManifest = {
  name: 'postgres',
  version: '0.1.0',
  description: 'PostgreSQL probes: database listing, active connections, slow queries',
  requires: {
    groups: [],
    files: [],
    commands: ['psql'],
  },
  probes: [
    {
      name: 'databases.list',
      description: 'List all PostgreSQL databases with sizes',
      capability: 'observe',
      params: {
        host: {
          type: 'string',
          description: 'Database host',
          required: false,
          default: 'localhost',
        },
        port: { type: 'number', description: 'Database port', required: false, default: 5432 },
        user: {
          type: 'string',
          description: 'Database user',
          required: false,
          default: 'postgres',
        },
      },
      timeout: 15_000,
    },
    {
      name: 'connections.active',
      description: 'List active PostgreSQL connections',
      capability: 'observe',
      params: {
        host: {
          type: 'string',
          description: 'Database host',
          required: false,
          default: 'localhost',
        },
        port: { type: 'number', description: 'Database port', required: false, default: 5432 },
        user: {
          type: 'string',
          description: 'Database user',
          required: false,
          default: 'postgres',
        },
      },
      timeout: 15_000,
    },
    {
      name: 'query.slow',
      description: 'List currently running slow queries (> threshold)',
      capability: 'observe',
      params: {
        host: {
          type: 'string',
          description: 'Database host',
          required: false,
          default: 'localhost',
        },
        port: { type: 'number', description: 'Database port', required: false, default: 5432 },
        user: {
          type: 'string',
          description: 'Database user',
          required: false,
          default: 'postgres',
        },
        thresholdMs: {
          type: 'number',
          description: 'Slow query threshold in ms',
          required: false,
          default: 1000,
        },
      },
      timeout: 15_000,
    },
  ],
  runbook: {
    category: 'postgres',
    probes: ['databases.list', 'connections.active', 'query.slow'],
    parallel: true,
  },
  detect: {
    commands: ['psql'],
  },
};
