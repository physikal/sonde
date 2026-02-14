import type { PackManifest } from '@sonde/shared';

export const systemdManifest: PackManifest = {
  name: 'systemd',
  version: '0.1.0',
  description: 'systemd service and journal probes',
  requires: {
    groups: [],
    files: [],
    commands: ['systemctl'],
  },
  probes: [
    {
      name: 'services.list',
      description: 'List all systemd service units',
      capability: 'observe',
      timeout: 10_000,
    },
    {
      name: 'service.status',
      description: 'Detailed status of a specific service',
      capability: 'observe',
      params: {
        service: { type: 'string', description: 'Service unit name', required: true },
      },
      timeout: 10_000,
    },
    {
      name: 'journal.query',
      description: 'Query journal logs for a unit',
      capability: 'observe',
      params: {
        unit: { type: 'string', description: 'Systemd unit name', required: true },
        lines: {
          type: 'number',
          description: 'Number of log entries',
          required: false,
          default: 50,
        },
      },
      timeout: 15_000,
    },
  ],
  runbook: {
    category: 'systemd',
    probes: ['services.list'],
    parallel: true,
  },
  detect: {
    files: ['/run/systemd/system'],
  },
};
