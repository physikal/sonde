import type { ProbeHandler } from '../../types.js';

export interface MemoryUsageResult {
  usedMemory: number;
  usedMemoryHuman: string;
  usedMemoryPeak: number;
  usedMemoryPeakHuman: string;
  usedMemoryRss: number;
  usedMemoryRssHuman: string;
  memFragmentationRatio: number;
  maxmemory: number;
  maxmemoryHuman: string;
  maxmemoryPolicy: string;
}

export const memoryUsage: ProbeHandler = async (params, exec) => {
  const host = (params?.host as string) ?? '127.0.0.1';
  const port = String((params?.port as number) ?? 6379);

  const stdout = await exec('redis-cli', ['-h', host, '-p', port, 'INFO', 'memory']);
  return parseMemoryUsage(stdout);
};

export function parseMemoryUsage(stdout: string): MemoryUsageResult {
  const kv: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    kv[trimmed.slice(0, colonIdx)] = trimmed.slice(colonIdx + 1);
  }

  return {
    usedMemory: Number(kv['used_memory']) || 0,
    usedMemoryHuman: kv['used_memory_human'] ?? '',
    usedMemoryPeak: Number(kv['used_memory_peak']) || 0,
    usedMemoryPeakHuman: kv['used_memory_peak_human'] ?? '',
    usedMemoryRss: Number(kv['used_memory_rss']) || 0,
    usedMemoryRssHuman: kv['used_memory_rss_human'] ?? '',
    memFragmentationRatio: Number.parseFloat(kv['mem_fragmentation_ratio'] ?? '0'),
    maxmemory: Number(kv['maxmemory']) || 0,
    maxmemoryHuman: kv['maxmemory_human'] ?? '',
    maxmemoryPolicy: kv['maxmemory_policy'] ?? '',
  };
}
