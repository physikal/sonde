import type { PackManifest } from '@sonde/shared';

export const dockerManifest: PackManifest = {
  name: 'docker',
  version: '0.1.0',
  description: 'Docker container and image management probes',
  requires: {
    groups: [],
    files: [],
    commands: ['docker'],
  },
  probes: [
    {
      name: 'containers.list',
      description: 'List all Docker containers with status',
      capability: 'observe',
      timeout: 10_000,
    },
    {
      name: 'logs.tail',
      description: 'Tail recent logs from a container',
      capability: 'observe',
      params: {
        container: { type: 'string', description: 'Container name or ID', required: true },
        lines: {
          type: 'number',
          description: 'Number of lines to tail',
          required: false,
          default: 100,
        },
      },
      timeout: 15_000,
    },
    {
      name: 'images.list',
      description: 'List all Docker images',
      capability: 'observe',
      timeout: 10_000,
    },
    {
      name: 'daemon.info',
      description: 'Docker daemon information and resource summary',
      capability: 'observe',
      timeout: 10_000,
    },
  ],
  runbook: {
    category: 'docker',
    probes: ['containers.list', 'images.list', 'daemon.info'],
    parallel: true,
  },
  detect: {
    commands: ['docker'],
  },
};
