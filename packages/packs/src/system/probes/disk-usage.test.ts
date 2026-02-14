import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { DiskUsageResult } from './disk-usage.js';
import { diskUsage, parseDfOutput } from './disk-usage.js';

const SAMPLE_DF_OUTPUT = `Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/sda1         51474044  31285940  17548392      65% /
/dev/sdb1        103081248  45234112  52579600      47% /data
tmpfs              8152560         0   8152560       0% /dev/shm
`;

describe('parseDfOutput', () => {
  it('parses df -kP output into structured data', () => {
    const result = parseDfOutput(SAMPLE_DF_OUTPUT);

    expect(result.filesystems).toHaveLength(2);

    expect(result.filesystems[0]).toEqual({
      filesystem: '/dev/sda1',
      sizeKb: 51474044,
      usedKb: 31285940,
      availableKb: 17548392,
      usePct: 65,
      mountedOn: '/',
    });

    expect(result.filesystems[1]).toEqual({
      filesystem: '/dev/sdb1',
      sizeKb: 103081248,
      usedKb: 45234112,
      availableKb: 52579600,
      usePct: 47,
      mountedOn: '/data',
    });
  });

  it('filters out tmpfs and devtmpfs', () => {
    const result = parseDfOutput(SAMPLE_DF_OUTPUT);
    const names = result.filesystems.map((f) => f.filesystem);
    expect(names).not.toContain('tmpfs');
    expect(names).not.toContain('devtmpfs');
  });

  it('handles single filesystem output', () => {
    const output = `Filesystem     1024-blocks  Used Available Capacity Mounted on
/dev/vda1         25671908 5432100  19912300      22% /
`;
    const result = parseDfOutput(output);
    expect(result.filesystems).toHaveLength(1);
    expect(result.filesystems[0]?.usePct).toBe(22);
  });

  it('returns empty array for header-only output', () => {
    const output = `Filesystem     1024-blocks  Used Available Capacity Mounted on
`;
    const result = parseDfOutput(output);
    expect(result.filesystems).toHaveLength(0);
  });
});

describe('diskUsage handler', () => {
  it('calls df -kP and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('df');
      expect(args).toEqual(['-kP']);
      return SAMPLE_DF_OUTPUT;
    };

    const result = (await diskUsage(undefined, mockExec)) as DiskUsageResult;
    expect(result.filesystems).toHaveLength(2);
    expect(result.filesystems[0]?.mountedOn).toBe('/');
  });
});
