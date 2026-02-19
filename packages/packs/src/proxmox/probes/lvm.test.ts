import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { LvmResult } from './lvm.js';
import { lvm, parseLvm } from './lvm.js';

const LVS_OUTPUT = JSON.stringify({
  report: [
    {
      lv: [
        {
          lv_name: 'data',
          vg_name: 'pve',
          lv_size: '200000000000B',
          lv_attr: '-wi-a-----',
          pool_lv: '',
          data_percent: '',
        },
        {
          lv_name: 'root',
          vg_name: 'pve',
          lv_size: '50000000000B',
          lv_attr: '-wi-a-----',
          pool_lv: '',
          data_percent: '',
        },
        {
          lv_name: 'thinpool',
          vg_name: 'pve',
          lv_size: '400000000000B',
          lv_attr: 'twi-aotz--',
          pool_lv: '',
          data_percent: '92.50',
        },
      ],
    },
  ],
});

const VGS_OUTPUT = JSON.stringify({
  report: [
    {
      vg: [
        { vg_name: 'pve', vg_size: '500000000000B', vg_free: '0B', pv_count: '1', lv_count: '3' },
      ],
    },
  ],
});

const PVS_OUTPUT = JSON.stringify({
  report: [
    {
      pv: [
        {
          pv_name: '/dev/sda3',
          vg_name: 'pve',
          pv_size: '500000000000B',
          pv_free: '0B',
          pv_fmt: 'lvm2',
        },
      ],
    },
  ],
});

describe('parseLvm', () => {
  it('parses LVM topology from JSON reports', () => {
    const result = parseLvm(LVS_OUTPUT, VGS_OUTPUT, PVS_OUTPUT);

    expect(result.logicalVolumes).toHaveLength(3);
    expect(result.logicalVolumes[0]?.name).toBe('data');
    expect(result.logicalVolumes[0]?.vgName).toBe('pve');

    expect(result.volumeGroups).toHaveLength(1);
    expect(result.volumeGroups[0]?.name).toBe('pve');

    expect(result.physicalVolumes).toHaveLength(1);
    expect(result.physicalVolumes[0]?.name).toBe('/dev/sda3');
    expect(result.physicalVolumes[0]?.format).toBe('lvm2');
  });

  it('flags thin pool with high usage', () => {
    const result = parseLvm(LVS_OUTPUT, VGS_OUTPUT, PVS_OUTPUT);
    expect(result.warnings.some((w) => w.includes('thinpool') && w.includes('92.50'))).toBe(true);
  });

  it('flags VGs with no free space', () => {
    const result = parseLvm(LVS_OUTPUT, VGS_OUTPUT, PVS_OUTPUT);
    expect(result.warnings).toContain('Volume group pve has no free space');
  });

  it('does not flag healthy thin pools', () => {
    const healthyLvs = JSON.stringify({
      report: [
        {
          lv: [
            {
              lv_name: 'thinpool',
              vg_name: 'pve',
              lv_size: '400B',
              lv_attr: 'twi-aotz--',
              pool_lv: '',
              data_percent: '50.00',
            },
          ],
        },
      ],
    });
    const healthyVgs = JSON.stringify({
      report: [
        {
          vg: [{ vg_name: 'pve', vg_size: '500B', vg_free: '100B', pv_count: '1', lv_count: '1' }],
        },
      ],
    });
    const result = parseLvm(healthyLvs, healthyVgs, PVS_OUTPUT);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('lvm handler', () => {
  it('calls lvs, vgs, pvs with correct args', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'lvs') return LVS_OUTPUT;
      if (cmd === 'vgs') return VGS_OUTPUT;
      return PVS_OUTPUT;
    };

    const result = (await lvm(undefined, mockExec)) as LvmResult;
    expect(result.logicalVolumes).toHaveLength(3);

    expect(calls).toHaveLength(3);
    expect(calls[0]?.cmd).toBe('lvs');
    expect(calls[0]?.args).toContain('--reportformat');
    expect(calls[0]?.args).toContain('json');
    expect(calls[1]?.cmd).toBe('vgs');
    expect(calls[2]?.cmd).toBe('pvs');
  });
});
