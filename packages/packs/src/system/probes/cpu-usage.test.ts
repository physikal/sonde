import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { CpuUsageResult } from './cpu-usage.js';
import { cpuUsage, parseLoadAvg } from './cpu-usage.js';

describe('parseLoadAvg', () => {
  it('parses /proc/loadavg and nproc output', () => {
    const result = parseLoadAvg('1.52 0.89 0.65 2/345 12345\n', '4\n');

    expect(result.loadAvg1).toBeCloseTo(1.52);
    expect(result.loadAvg5).toBeCloseTo(0.89);
    expect(result.loadAvg15).toBeCloseTo(0.65);
    expect(result.cpuCount).toBe(4);
  });

  it('handles high load values', () => {
    const result = parseLoadAvg('24.50 18.30 12.10 5/1200 99999\n', '8\n');

    expect(result.loadAvg1).toBeCloseTo(24.5);
    expect(result.loadAvg5).toBeCloseTo(18.3);
    expect(result.loadAvg15).toBeCloseTo(12.1);
    expect(result.cpuCount).toBe(8);
  });

  it('handles single CPU', () => {
    const result = parseLoadAvg('0.01 0.02 0.00 1/50 100\n', '1\n');

    expect(result.loadAvg1).toBeCloseTo(0.01);
    expect(result.cpuCount).toBe(1);
  });
});

describe('cpuUsage handler', () => {
  it('calls cat /proc/loadavg and nproc, returns parsed result', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];

    const mockExec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'cat' && args[0] === '/proc/loadavg') {
        return '2.10 1.50 0.90 3/400 54321\n';
      }
      if (cmd === 'nproc') {
        return '16\n';
      }
      throw new Error(`Unexpected command: ${cmd}`);
    };

    const result = (await cpuUsage(undefined, mockExec)) as CpuUsageResult;
    expect(result.loadAvg1).toBeCloseTo(2.1);
    expect(result.loadAvg5).toBeCloseTo(1.5);
    expect(result.loadAvg15).toBeCloseTo(0.9);
    expect(result.cpuCount).toBe(16);
    expect(calls).toHaveLength(2);
  });
});
