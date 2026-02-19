import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { LxcListResult } from './lxc-list.js';
import { lxcList, parseLxcList } from './lxc-list.js';

const SAMPLE_OUTPUT = `VMID       Status     Lock         Name
200        running                 ct-nginx
201        stopped    backup       ct-db
202        running                 ct-redis`;

describe('parseLxcList', () => {
  it('parses container list output', () => {
    const result = parseLxcList(SAMPLE_OUTPUT);
    expect(result.containers).toHaveLength(3);
  });

  it('extracts VMID, status, and name', () => {
    const result = parseLxcList(SAMPLE_OUTPUT);
    expect(result.containers[0]).toEqual({
      vmid: 200,
      status: 'running',
      lock: '',
      name: 'ct-nginx',
    });
  });

  it('extracts lock status when present', () => {
    const result = parseLxcList(SAMPLE_OUTPUT);
    expect(result.containers[1]).toEqual({
      vmid: 201,
      status: 'stopped',
      lock: 'backup',
      name: 'ct-db',
    });
  });

  it('handles empty output', () => {
    const result = parseLxcList('');
    expect(result.containers).toHaveLength(0);
  });

  it('handles header-only output', () => {
    const result = parseLxcList('VMID       Status     Lock         Name');
    expect(result.containers).toHaveLength(0);
  });
});

describe('lxcList handler', () => {
  it('calls pct list and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('pct');
      expect(args).toEqual(['list']);
      return SAMPLE_OUTPUT;
    };

    const result = (await lxcList(undefined, mockExec)) as LxcListResult;
    expect(result.containers).toHaveLength(3);
    expect(result.containers[0]?.vmid).toBe(200);
  });
});
