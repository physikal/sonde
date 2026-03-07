import type { PackManifest } from '@sonde/shared';

export const opentofuManifest: PackManifest = {
  name: 'opentofu',
  version: '0.1.0',
  description: 'OpenTofu infrastructure state and validation probes',
  requires: {
    groups: [],
    files: [],
    commands: ['tofu'],
  },
  probes: [
    {
      name: 'version',
      description: 'OpenTofu version and platform info',
      capability: 'observe',
      timeout: 10_000,
    },
    {
      name: 'state.list',
      description: 'List all resources in state',
      capability: 'observe',
      params: {
        dir: {
          type: 'string',
          description: 'Working directory containing .terraform/',
          required: false,
        },
      },
      timeout: 15_000,
    },
    {
      name: 'state.show',
      description: 'Full state as structured JSON',
      capability: 'observe',
      params: {
        dir: {
          type: 'string',
          description: 'Working directory containing .terraform/',
          required: false,
        },
      },
      timeout: 30_000,
    },
    {
      name: 'validate',
      description: 'Validate configuration syntax',
      capability: 'observe',
      params: {
        dir: {
          type: 'string',
          description: 'Working directory with .tf files',
          required: false,
        },
      },
      timeout: 30_000,
    },
    {
      name: 'output',
      description: 'Output values from state',
      capability: 'observe',
      params: {
        dir: {
          type: 'string',
          description: 'Working directory containing .terraform/',
          required: false,
        },
      },
      timeout: 15_000,
    },
  ],
  detect: {
    commands: ['tofu'],
  },
  runbook: {
    category: 'infrastructure',
    probes: ['version', 'validate'],
    parallel: true,
  },
};
