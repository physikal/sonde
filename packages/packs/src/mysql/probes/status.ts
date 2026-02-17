import type { ProbeHandler } from '../../types.js';

export interface MysqlStatusResult {
  uptime: number;
  threads: number;
  questions: number;
  slowQueries: number;
  opens: number;
  openTables: number;
  queriesPerSecondAvg: number;
  variables: Record<string, string>;
}

export const status: ProbeHandler = async (params, exec) => {
  const host = (params?.host as string) ?? 'localhost';
  const port = String((params?.port as number) ?? 3306);
  const user = (params?.user as string) ?? 'root';

  const stdout = await exec('mysql', [
    '-h', host,
    '-P', port,
    '-u', user,
    '--batch', '--skip-column-names',
    '-e', 'SHOW GLOBAL STATUS',
  ]);
  return parseMysqlStatus(stdout);
};

export function parseMysqlStatus(stdout: string): MysqlStatusResult {
  const variables: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const parts = line.split('\t');
    if (parts.length >= 2) {
      variables[parts[0]!] = parts[1]!;
    }
  }

  const uptime = Number(variables['Uptime']) || 0;
  const questions = Number(variables['Questions']) || 0;

  return {
    uptime,
    threads: Number(variables['Threads_connected']) || 0,
    questions,
    slowQueries: Number(variables['Slow_queries']) || 0,
    opens: Number(variables['Opened_tables']) || 0,
    openTables: Number(variables['Open_tables']) || 0,
    queriesPerSecondAvg: uptime > 0 ? Math.round((questions / uptime) * 100) / 100 : 0,
    variables,
  };
}
