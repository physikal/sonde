import type { PackManifest } from '@sonde/shared';

export const nginxManifest: PackManifest = {
  name: 'nginx',
  version: '0.1.0',
  description: 'Nginx web server probes: config validation, access/error log tailing',
  requires: {
    groups: [],
    files: ['/etc/nginx/nginx.conf'],
    commands: ['nginx'],
  },
  probes: [
    {
      name: 'config.test',
      description: 'Test nginx configuration for syntax errors',
      capability: 'observe',
      timeout: 10_000,
    },
    {
      name: 'access.log.tail',
      description: 'Tail recent lines from the nginx access log',
      capability: 'observe',
      params: {
        logPath: {
          type: 'string',
          description: 'Path to access log file',
          required: false,
          default: '/var/log/nginx/access.log',
        },
        lines: {
          type: 'number',
          description: 'Number of lines to tail',
          required: false,
          default: 100,
        },
      },
      timeout: 10_000,
    },
    {
      name: 'error.log.tail',
      description: 'Tail recent lines from the nginx error log',
      capability: 'observe',
      params: {
        logPath: {
          type: 'string',
          description: 'Path to error log file',
          required: false,
          default: '/var/log/nginx/error.log',
        },
        lines: {
          type: 'number',
          description: 'Number of lines to tail',
          required: false,
          default: 100,
        },
      },
      timeout: 10_000,
    },
  ],
  runbook: {
    category: 'nginx',
    probes: ['config.test', 'error.log.tail'],
    parallel: true,
  },
  detect: {
    commands: ['nginx'],
    files: ['/etc/nginx/nginx.conf'],
  },
};
