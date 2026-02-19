import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { MemoryUsageResult } from './memory-usage.js';
import { memoryUsage, parseMemoryUsage } from './memory-usage.js';

const SAMPLE_OUTPUT = `# Memory
used_memory:13107200
used_memory_human:12.50M
used_memory_peak:15728640
used_memory_peak_human:15.00M
used_memory_rss:16777216
used_memory_rss_human:16.00M
mem_fragmentation_ratio:1.28
maxmemory:0
maxmemory_human:0B
maxmemory_policy:noeviction`;

describe('parseMemoryUsage', () => {
  it('parses memory fields', () => {
    const result = parseMemoryUsage(SAMPLE_OUTPUT);
    expect(result.usedMemory).toBe(13107200);
    expect(result.usedMemoryHuman).toBe('12.50M');
    expect(result.usedMemoryPeak).toBe(15728640);
    expect(result.usedMemoryPeakHuman).toBe('15.00M');
    expect(result.usedMemoryRss).toBe(16777216);
    expect(result.usedMemoryRssHuman).toBe('16.00M');
    expect(result.memFragmentationRatio).toBe(1.28);
    expect(result.maxmemory).toBe(0);
    expect(result.maxmemoryHuman).toBe('0B');
    expect(result.maxmemoryPolicy).toBe('noeviction');
  });

  it('handles empty output', () => {
    const result = parseMemoryUsage('');
    expect(result.usedMemory).toBe(0);
    expect(result.usedMemoryHuman).toBe('');
    expect(result.memFragmentationRatio).toBe(0);
    expect(result.maxmemoryPolicy).toBe('');
  });
});

describe('memoryUsage handler', () => {
  it('calls redis-cli INFO memory', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('redis-cli');
      expect(args).toContain('INFO');
      expect(args).toContain('memory');
      return SAMPLE_OUTPUT;
    };

    const result = (await memoryUsage(undefined, mockExec)) as MemoryUsageResult;
    expect(result.usedMemory).toBe(13107200);
  });
});
