import type { Pack } from '../types.js';
import { proxmoxAgentManifest } from './manifest.js';
import { cephStatus } from './probes/ceph-status.js';
import { clusterConfig } from './probes/cluster-config.js';
import { haStatus } from './probes/ha-status.js';
import { lvm } from './probes/lvm.js';
import { lxcConfig } from './probes/lxc-config.js';
import { lxcList } from './probes/lxc-list.js';
import { vmConfig } from './probes/vm-config.js';
import { vmLocks } from './probes/vm-locks.js';

export const proxmoxAgentPack: Pack = {
  manifest: proxmoxAgentManifest,
  handlers: {
    'proxmox-node.local.vm.config': vmConfig,
    'proxmox-node.local.ha.status': haStatus,
    'proxmox-node.local.lvm': lvm,
    'proxmox-node.local.ceph.status': cephStatus,
    'proxmox-node.local.lxc.config': lxcConfig,
    'proxmox-node.local.lxc.list': lxcList,
    'proxmox-node.local.cluster.config': clusterConfig,
    'proxmox-node.local.vm.locks': vmLocks,
  },
};
