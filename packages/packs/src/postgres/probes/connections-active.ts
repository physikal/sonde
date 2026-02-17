import type { ProbeHandler } from '../../types.js';

export interface ConnectionInfo {
  pid: number;
  database: string;
  user: string;
  clientAddr: string;
  state: string;
  query: string;
  backendStart: string;
}

export interface ConnectionsActiveResult {
  connections: ConnectionInfo[];
  total: number;
}

export const connectionsActive: ProbeHandler = async (params, exec) => {
  const host = (params?.host as string) ?? 'localhost';
  const port = String((params?.port as number) ?? 5432);
  const user = (params?.user as string) ?? 'postgres';

  const stdout = await exec('psql', [
    '-h', host,
    '-p', port,
    '-U', user,
    '-t', '-A', '-F', '\t',
    '-c', "SELECT pid, datname, usename, client_addr, state, LEFT(query, 200), backend_start FROM pg_stat_activity WHERE state IS NOT NULL AND pid <> pg_backend_pid() ORDER BY backend_start DESC",
  ]);
  return parseConnectionsActive(stdout);
};

export function parseConnectionsActive(stdout: string): ConnectionsActiveResult {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const connections: ConnectionInfo[] = lines.map((line) => {
    const parts = line.split('\t');
    return {
      pid: Number(parts[0]) || 0,
      database: parts[1] ?? '',
      user: parts[2] ?? '',
      clientAddr: parts[3] ?? '',
      state: parts[4] ?? '',
      query: parts[5] ?? '',
      backendStart: parts[6] ?? '',
    };
  });
  return { connections, total: connections.length };
}
