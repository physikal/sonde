import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { VmLocksResult } from './vm-locks.js';
import { parseVmLocks, vmLocks } from './vm-locks.js';

describe('parseVmLocks', () => {
  it('parses lock files into VM lock entries', () => {
    const stdout = `lock-100.conf
lock-101.conf
lock-200.conf`;
    const result = parseVmLocks(stdout);
    expect(result.locks).toHaveLength(3);
    expect(result.locks[0]).toEqual({ vmid: 100, file: 'lock-100.conf' });
    expect(result.locks[2]).toEqual({ vmid: 200, file: 'lock-200.conf' });
  });

  it('generates warning when locks exist', () => {
    const stdout = 'lock-100.conf\nlock-101.conf';
    const result = parseVmLocks(stdout);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('2 VM(s) locked');
    expect(result.warnings[0]).toContain('100');
    expect(result.warnings[0]).toContain('101');
  });

  it('returns empty for no lock files', () => {
    const result = parseVmLocks('');
    expect(result.locks).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('ignores non-lock files', () => {
    const stdout = `lock-100.conf
readme.txt
some-other-file`;
    const result = parseVmLocks(stdout);
    expect(result.locks).toHaveLength(1);
    expect(result.locks[0]?.vmid).toBe(100);
  });
});

describe('vmLocks handler', () => {
  it('calls ls on the lock directory', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('ls');
      expect(args).toEqual(['/run/lock/qemu-server/']);
      return 'lock-100.conf\nlock-101.conf';
    };

    const result = (await vmLocks(undefined, mockExec)) as VmLocksResult;
    expect(result.locks).toHaveLength(2);
  });

  it('returns empty when directory does not exist', async () => {
    const mockExec: ExecFn = async () => {
      throw new Error('No such file or directory');
    };

    const result = (await vmLocks(undefined, mockExec)) as VmLocksResult;
    expect(result.locks).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
