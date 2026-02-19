import type { PackManifest } from '@sonde/shared';

export const proxmoxAgentManifest: PackManifest = {
  name: 'proxmox-node',
  version: '0.1.0',
  description: 'Proxmox VE node-local probes — VM/LXC config, HA status, LVM, Ceph, cluster',
  requires: {
    groups: [],
    files: ['/etc/pve/'],
    commands: ['qm', 'pct', 'ha-manager', 'pvesh', 'lvs', 'vgs', 'pvs', 'pvecm'],
  },
  probes: [
    {
      name: 'local.vm.config',
      description: 'QEMU VM configuration via qm config',
      capability: 'observe',
      params: {
        vmid: { type: 'number', description: 'VM ID', required: true },
      },
      timeout: 10_000,
    },
    {
      name: 'local.ha.status',
      description: 'HA manager resource states',
      capability: 'observe',
      timeout: 10_000,
    },
    {
      name: 'local.lvm',
      description: 'LVM topology — logical volumes, volume groups, physical volumes',
      capability: 'observe',
      timeout: 15_000,
    },
    {
      name: 'local.ceph.status',
      description: 'Ceph cluster health, OSD status, and PG states',
      capability: 'observe',
      timeout: 15_000,
    },
    {
      name: 'local.lxc.config',
      description: 'LXC container configuration via pct config',
      capability: 'observe',
      params: {
        vmid: { type: 'number', description: 'Container VMID', required: true },
      },
      timeout: 10_000,
    },
    {
      name: 'local.lxc.list',
      description: 'List all LXC containers on this node',
      capability: 'observe',
      timeout: 10_000,
    },
    {
      name: 'local.cluster.config',
      description: 'Cluster membership, quorum, and vote status via pvecm',
      capability: 'observe',
      timeout: 10_000,
    },
    {
      name: 'local.vm.locks',
      description: 'Check for locked QEMU VMs via /run/lock/qemu-server/',
      capability: 'observe',
      timeout: 10_000,
    },
  ],
  runbook: {
    category: 'proxmox',
    probes: ['local.ha.status', 'local.lvm', 'local.cluster.config'],
    parallel: true,
  },
  detect: {
    commands: ['qm', 'pct'],
  },
};
