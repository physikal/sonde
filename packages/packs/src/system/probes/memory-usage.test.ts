import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { MemoryUsageResult } from './memory-usage.js';
import { memoryUsage, parseFreeOutput } from './memory-usage.js';

const SAMPLE_FREE_OUTPUT = `              total        used        free      shared  buff/cache   available
Mem:    16595034112  8234127360  1021071360   348321792  7339835392 10543906816
Swap:    8589930496  1073741824  7516188672
`;

describe('parseFreeOutput', () => {
  it('parses free -b output into structured data', () => {
    const result = parseFreeOutput(SAMPLE_FREE_OUTPUT);

    expect(result.totalBytes).toBe(16595034112);
    expect(result.usedBytes).toBe(8234127360);
    expect(result.freeBytes).toBe(1021071360);
    expect(result.availableBytes).toBe(10543906816);
    expect(result.swap.totalBytes).toBe(8589930496);
    expect(result.swap.usedBytes).toBe(1073741824);
    expect(result.swap.freeBytes).toBe(7516188672);
  });

  it('handles no swap', () => {
    const output = `              total        used        free      shared  buff/cache   available
Mem:     4153344000  2076672000   512000000   100000000  1564672000  2576672000
Swap:             0           0           0
`;
    const result = parseFreeOutput(output);
    expect(result.totalBytes).toBe(4153344000);
    expect(result.swap.totalBytes).toBe(0);
    expect(result.swap.usedBytes).toBe(0);
    expect(result.swap.freeBytes).toBe(0);
  });

  it('handles minimal output format', () => {
    const output = `              total        used        free      shared  buff/cache   available
Mem:     8000000000  4000000000  2000000000   500000000  1500000000  5000000000
`;
    const result = parseFreeOutput(output);
    expect(result.totalBytes).toBe(8000000000);
    expect(result.swap.totalBytes).toBe(0);
  });
});

describe('memoryUsage handler', () => {
  it('calls free -b and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('free');
      expect(args).toEqual(['-b']);
      return SAMPLE_FREE_OUTPUT;
    };

    const result = (await memoryUsage(undefined, mockExec)) as MemoryUsageResult;
    expect(result.totalBytes).toBe(16595034112);
    expect(result.swap.freeBytes).toBe(7516188672);
  });
});
