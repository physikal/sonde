import type { ProbeHandler } from '../../types.js';

export interface MysqlProcessInfo {
  id: number;
  user: string;
  host: string;
  db: string;
  command: string;
  time: number;
  state: string;
  info: string;
}

export interface MysqlProcesslistResult {
  processes: MysqlProcessInfo[];
  count: number;
}

export const processlist: ProbeHandler = async (params, exec) => {
  const host = (params?.host as string) ?? 'localhost';
  const port = String((params?.port as number) ?? 3306);
  const user = (params?.user as string) ?? 'root';

  const stdout = await exec('mysql', [
    '-h',
    host,
    '-P',
    port,
    '-u',
    user,
    '--batch',
    '--skip-column-names',
    '-e',
    'SELECT ID, USER, HOST, IFNULL(DB, ""), COMMAND, TIME, IFNULL(STATE, ""), LEFT(IFNULL(INFO, ""), 200) FROM information_schema.PROCESSLIST ORDER BY TIME DESC',
  ]);
  return parseProcesslist(stdout);
};

export function parseProcesslist(stdout: string): MysqlProcesslistResult {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const processes: MysqlProcessInfo[] = lines.map((line) => {
    const parts = line.split('\t');
    return {
      id: Number(parts[0]) || 0,
      user: parts[1] ?? '',
      host: parts[2] ?? '',
      db: parts[3] ?? '',
      command: parts[4] ?? '',
      time: Number(parts[5]) || 0,
      state: parts[6] ?? '',
      info: parts[7] ?? '',
    };
  });
  return { processes, count: processes.length };
}
