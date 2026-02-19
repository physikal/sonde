import type { ProbeHandler } from '../../types.js';

export interface DbKeyCount {
  db: number;
  keys: number;
  expires: number;
}

export interface KeysCountResult {
  databases: DbKeyCount[];
  totalKeys: number;
}

export const keysCount: ProbeHandler = async (params, exec) => {
  const host = (params?.host as string) ?? '127.0.0.1';
  const port = String((params?.port as number) ?? 6379);

  const stdout = await exec('redis-cli', ['-h', host, '-p', port, 'INFO', 'keyspace']);
  return parseKeysCount(stdout);
};

export function parseKeysCount(stdout: string): KeysCountResult {
  const databases: DbKeyCount[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    // Lines like: db0:keys=123,expires=10,avg_ttl=0
    const match = trimmed.match(/^db(\d+):keys=(\d+),expires=(\d+)/);
    if (match) {
      databases.push({
        db: Number(match[1]),
        keys: Number(match[2]),
        expires: Number(match[3]),
      });
    }
  }
  const totalKeys = databases.reduce((sum, d) => sum + d.keys, 0);
  return { databases, totalKeys };
}
