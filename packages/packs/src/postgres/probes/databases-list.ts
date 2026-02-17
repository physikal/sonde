import type { ProbeHandler } from '../../types.js';

export interface DatabaseInfo {
  name: string;
  owner: string;
  encoding: string;
  sizePretty: string;
}

export interface DatabasesListResult {
  databases: DatabaseInfo[];
  count: number;
}

export const databasesList: ProbeHandler = async (params, exec) => {
  const host = (params?.host as string) ?? 'localhost';
  const port = String((params?.port as number) ?? 5432);
  const user = (params?.user as string) ?? 'postgres';

  const stdout = await exec('psql', [
    '-h', host,
    '-p', port,
    '-U', user,
    '-t', '-A', '-F', '\t',
    '-c', 'SELECT datname, pg_catalog.pg_get_userbyid(datdba), pg_catalog.pg_encoding_to_char(encoding), pg_catalog.pg_size_pretty(pg_catalog.pg_database_size(datname)) FROM pg_catalog.pg_database WHERE datistemplate = false ORDER BY datname',
  ]);
  return parseDatabasesList(stdout);
};

export function parseDatabasesList(stdout: string): DatabasesListResult {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const databases: DatabaseInfo[] = lines.map((line) => {
    const [name, owner, encoding, sizePretty] = line.split('\t');
    return {
      name: name ?? '',
      owner: owner ?? '',
      encoding: encoding ?? '',
      sizePretty: sizePretty ?? '',
    };
  });
  return { databases, count: databases.length };
}
