import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { MysqlDatabasesListResult } from './databases-list.js';
import { databasesList, parseDatabasesList } from './databases-list.js';

const SAMPLE_OUTPUT = `information_schema\t79\t0.00
myapp\t15\t256.50
mysql\t38\t2.44`;

describe('parseDatabasesList', () => {
  it('parses mysql output into structured data', () => {
    const result = parseDatabasesList(SAMPLE_OUTPUT);
    expect(result.count).toBe(3);
    expect(result.databases[0]).toEqual({
      name: 'information_schema',
      tables: 79,
      sizeMb: 0,
    });
    expect(result.databases[1]).toEqual({
      name: 'myapp',
      tables: 15,
      sizeMb: 256.5,
    });
  });

  it('handles empty output', () => {
    const result = parseDatabasesList('');
    expect(result.count).toBe(0);
    expect(result.databases).toEqual([]);
  });
});

describe('databasesList handler', () => {
  it('calls mysql with default params', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('mysql');
      expect(args).toContain('-h');
      expect(args).toContain('localhost');
      expect(args).toContain('-P');
      expect(args).toContain('3306');
      expect(args).toContain('-u');
      expect(args).toContain('root');
      expect(args).toContain('--batch');
      expect(args).toContain('--skip-column-names');
      return SAMPLE_OUTPUT;
    };

    const result = (await databasesList(undefined, mockExec)) as MysqlDatabasesListResult;
    expect(result.count).toBe(3);
  });

  it('passes custom host/port/user', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(args).toContain('db.example.com');
      expect(args).toContain('3307');
      expect(args).toContain('admin');
      return SAMPLE_OUTPUT;
    };

    await databasesList({ host: 'db.example.com', port: 3307, user: 'admin' }, mockExec);
  });
});
