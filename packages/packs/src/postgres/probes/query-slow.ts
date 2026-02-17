import type { ProbeHandler } from '../../types.js';

export interface SlowQueryInfo {
  pid: number;
  database: string;
  user: string;
  durationMs: number;
  state: string;
  query: string;
}

export interface QuerySlowResult {
  queries: SlowQueryInfo[];
  count: number;
  thresholdMs: number;
}

export const querySlow: ProbeHandler = async (params, exec) => {
  const host = (params?.host as string) ?? 'localhost';
  const port = String((params?.port as number) ?? 5432);
  const user = (params?.user as string) ?? 'postgres';
  const thresholdMs = (params?.thresholdMs as number) ?? 1000;

  const stdout = await exec('psql', [
    '-h', host,
    '-p', port,
    '-U', user,
    '-t', '-A', '-F', '\t',
    '-c', `SELECT pid, datname, usename, EXTRACT(EPOCH FROM (now() - query_start))::int * 1000, state, LEFT(query, 300) FROM pg_stat_activity WHERE state = 'active' AND pid <> pg_backend_pid() AND EXTRACT(EPOCH FROM (now() - query_start)) * 1000 > ${thresholdMs} ORDER BY query_start ASC`,
  ]);
  return parseQuerySlow(stdout, thresholdMs);
};

export function parseQuerySlow(stdout: string, thresholdMs: number): QuerySlowResult {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const queries: SlowQueryInfo[] = lines.map((line) => {
    const parts = line.split('\t');
    return {
      pid: Number(parts[0]) || 0,
      database: parts[1] ?? '',
      user: parts[2] ?? '',
      durationMs: Number(parts[3]) || 0,
      state: parts[4] ?? '',
      query: parts[5] ?? '',
    };
  });
  return { queries, count: queries.length, thresholdMs };
}
