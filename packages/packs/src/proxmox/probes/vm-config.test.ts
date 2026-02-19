import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { VmConfigResult } from './vm-config.js';
import { parseVmConfig, vmConfig } from './vm-config.js';

const SAMPLE_OUTPUT = `boot: order=scsi0;ide2;net0
cores: 4
ide2: none,media=cdrom
memory: 8192
name: web-server-01
net0: virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,firewall=1
numa: 0
ostype: l26
scsi0: ceph-pool:vm-100-disk-0,iothread=1,size=64G
scsihw: virtio-scsi-single
smbios1: uuid=abc-def-123
sockets: 1
virtio1: local-lvm:vm-100-disk-1,size=128G`;

describe('parseVmConfig', () => {
  it('parses key: value pairs into config map', () => {
    const result = parseVmConfig(SAMPLE_OUTPUT, 100);
    expect(result.vmid).toBe(100);
    expect(result.config.name).toBe('web-server-01');
    expect(result.config.memory).toBe('8192');
    expect(result.config.cores).toBe('4');
  });

  it('identifies disk entries with storage backend and size', () => {
    const result = parseVmConfig(SAMPLE_OUTPUT, 100);
    expect(result.disks).toHaveLength(2);

    expect(result.disks[0]).toEqual({
      key: 'scsi0',
      storage: 'ceph-pool',
      volume: 'vm-100-disk-0',
      format: 'raw',
      size: '64G',
    });

    expect(result.disks[1]).toEqual({
      key: 'virtio1',
      storage: 'local-lvm',
      volume: 'vm-100-disk-1',
      format: 'raw',
      size: '128G',
    });
  });

  it('warns about local storage disks', () => {
    const result = parseVmConfig(SAMPLE_OUTPUT, 100);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('local-lvm');
    expect(result.warnings[0]).toContain('virtio1');
  });

  it('skips non-disk config entries like net0', () => {
    const result = parseVmConfig(SAMPLE_OUTPUT, 100);
    const diskKeys = result.disks.map((d) => d.key);
    expect(diskKeys).not.toContain('net0');
  });

  it('handles empty output', () => {
    const result = parseVmConfig('', 100);
    expect(result.config).toEqual({});
    expect(result.disks).toHaveLength(0);
  });

  it('detects qcow2 format from filename', () => {
    const output = 'scsi0: local:100/vm-100-disk-0.qcow2,size=32G';
    const result = parseVmConfig(output, 100);
    expect(result.disks[0]?.format).toBe('qcow2');
  });
});

describe('vmConfig handler', () => {
  it('calls qm config with vmid and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('qm');
      expect(args).toEqual(['config', '100']);
      return SAMPLE_OUTPUT;
    };

    const result = (await vmConfig({ vmid: 100 }, mockExec)) as VmConfigResult;
    expect(result.vmid).toBe(100);
    expect(result.disks).toHaveLength(2);
  });

  it('throws when vmid is missing', async () => {
    const mockExec: ExecFn = async () => '';
    await expect(vmConfig({}, mockExec)).rejects.toThrow('vmid parameter is required');
  });
});
