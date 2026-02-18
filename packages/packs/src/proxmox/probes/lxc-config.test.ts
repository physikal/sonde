import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { LxcConfigResult } from './lxc-config.js';
import { lxcConfig, parseLxcConfig } from './lxc-config.js';

const SAMPLE_OUTPUT = `arch: amd64
cores: 2
hostname: ct-nginx
memory: 512
mp0: local-lvm:subvol-200-disk-1,mp=/data,size=20G
net0: name=eth0,bridge=vmbr0,firewall=1,hwaddr=AA:BB:CC:DD:EE:FF,ip=dhcp,type=veth
ostype: debian
rootfs: local-lvm:subvol-200-disk-0,size=8G
swap: 256
unprivileged: 1`;

describe('parseLxcConfig', () => {
  it('parses key: value pairs into config map', () => {
    const result = parseLxcConfig(SAMPLE_OUTPUT, 200);
    expect(result.vmid).toBe(200);
    expect(result.config.hostname).toBe('ct-nginx');
    expect(result.config.memory).toBe('512');
    expect(result.config.cores).toBe('2');
  });

  it('parses rootfs storage and size', () => {
    const result = parseLxcConfig(SAMPLE_OUTPUT, 200);
    expect(result.rootfs).toEqual({ storage: 'local-lvm', size: '8G' });
  });

  it('parses mountpoints', () => {
    const result = parseLxcConfig(SAMPLE_OUTPUT, 200);
    expect(result.mountpoints).toHaveLength(1);
    expect(result.mountpoints[0]).toEqual({
      key: 'mp0',
      storage: 'local-lvm',
      volume: 'subvol-200-disk-1',
      mountpoint: '/data',
      size: '20G',
    });
  });

  it('parses network interfaces', () => {
    const result = parseLxcConfig(SAMPLE_OUTPUT, 200);
    expect(result.network).toHaveLength(1);
    expect(result.network[0]?.key).toBe('net0');
    expect(result.network[0]?.raw).toContain('bridge=vmbr0');
  });

  it('handles no mountpoints', () => {
    const output = `hostname: ct-simple
rootfs: local-lvm:subvol-300-disk-0,size=4G`;
    const result = parseLxcConfig(output, 300);
    expect(result.mountpoints).toHaveLength(0);
    expect(result.rootfs).toEqual({ storage: 'local-lvm', size: '4G' });
  });

  it('handles missing rootfs', () => {
    const output = 'hostname: ct-minimal';
    const result = parseLxcConfig(output, 400);
    expect(result.rootfs).toBeNull();
  });

  it('handles empty output', () => {
    const result = parseLxcConfig('', 200);
    expect(result.config).toEqual({});
    expect(result.rootfs).toBeNull();
    expect(result.mountpoints).toHaveLength(0);
  });
});

describe('lxcConfig handler', () => {
  it('calls pct config with vmid and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('pct');
      expect(args).toEqual(['config', '200']);
      return SAMPLE_OUTPUT;
    };

    const result = (await lxcConfig({ vmid: 200 }, mockExec)) as LxcConfigResult;
    expect(result.vmid).toBe(200);
    expect(result.rootfs?.storage).toBe('local-lvm');
  });

  it('throws when vmid is missing', async () => {
    const mockExec: ExecFn = async () => '';
    await expect(lxcConfig({}, mockExec)).rejects.toThrow('vmid parameter is required');
  });
});
