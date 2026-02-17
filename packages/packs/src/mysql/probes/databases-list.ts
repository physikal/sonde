import type { ProbeHandler } from '../../types.js';

export interface MysqlDatabaseInfo {
  name: string;
  tables: number;
  sizeMb: number;
}

export interface MysqlDatabasesListResult {
  databases: MysqlDatabaseInfo[];
  count: number;
}

export const databasesList: ProbeHandler = async (params, exec) => {
  const host = (params?.host as string) ?? 'localhost';
  const port = String((params?.port as number) ?? 3306);
  const user = (params?.user as string) ?? 'root';

  const stdout = await exec('mysql', [
    '-h', host,
    '-P', port,
    '-u', user,
    '--batch', '--skip-column-names',
    '-e', "SELECT s.SCHEMA_NAME, COUNT(t.TABLE_NAME), ROUND(SUM(t.DATA_LENGTH + t.INDEX_LENGTH) / 1024 / 1024, 2) FROM information_schema.SCHEMATA s LEFT JOIN information_schema.TABLES t ON s.SCHEMA_NAME = t.TABLE_SCHEMA GROUP BY s.SCHEMA_NAME ORDER BY s.SCHEMA_NAME",
  ]);
  return parseDatabasesList(stdout);
};

export function parseDatabasesList(stdout: string): MysqlDatabasesListResult {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const databases: MysqlDatabaseInfo[] = lines.map((line) => {
    const parts = line.split('\t');
    return {
      name: parts[0] ?? '',
      tables: Number(parts[1]) || 0,
      sizeMb: Number(parts[2]) || 0,
    };
  });
  return { databases, count: databases.length };
}
