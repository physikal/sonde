import type { ProbeHandler } from '../../types.js';

export interface RedisInfoResult {
  version: string;
  uptimeSeconds: number;
  connectedClients: number;
  usedMemoryHuman: string;
  usedMemoryPeakHuman: string;
  totalConnectionsReceived: number;
  totalCommandsProcessed: number;
  role: string;
  raw: Record<string, string>;
}

export const info: ProbeHandler = async (params, exec) => {
  const host = (params?.host as string) ?? '127.0.0.1';
  const port = String((params?.port as number) ?? 6379);

  const stdout = await exec('redis-cli', ['-h', host, '-p', port, 'INFO']);
  return parseRedisInfo(stdout);
};

export function parseRedisInfo(stdout: string): RedisInfoResult {
  const raw: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx);
    const value = trimmed.slice(colonIdx + 1);
    raw[key] = value;
  }

  return {
    version: raw['redis_version'] ?? '',
    uptimeSeconds: Number(raw['uptime_in_seconds']) || 0,
    connectedClients: Number(raw['connected_clients']) || 0,
    usedMemoryHuman: raw['used_memory_human'] ?? '',
    usedMemoryPeakHuman: raw['used_memory_peak_human'] ?? '',
    totalConnectionsReceived: Number(raw['total_connections_received']) || 0,
    totalCommandsProcessed: Number(raw['total_commands_processed']) || 0,
    role: raw['role'] ?? '',
    raw,
  };
}
