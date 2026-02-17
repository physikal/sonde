import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { DatabasesListResult } from './databases-list.js';
import { databasesList, parseDatabasesList } from './databases-list.js';

const SAMPLE_OUTPUT = `postgres\tpostgres\tUTF8\t8537 kB
myapp\tappuser\tUTF8\t156 MB
analytics\tanalyst\tUTF8\t2345 MB`;

describe('parseDatabasesList', () => {
  it('parses psql output into structured data', () => {
    const result = parseDatabasesList(SAMPLE_OUTPUT);
    expect(result.count).toBe(3);
    expect(result.databases[0]).toEqual({
      name: 'postgres',
      owner: 'postgres',
      encoding: 'UTF8',
      sizePretty: '8537 kB',
    });
    expect(result.databases[1]?.name).toBe('myapp');
  });

  it('handles empty output', () => {
    const result = parseDatabasesList('');
    expect(result.count).toBe(0);
    expect(result.databases).toEqual([]);
  });
});

describe('databasesList handler', () => {
  it('calls psql with default params', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('psql');
      expect(args).toContain('-h');
      expect(args).toContain('localhost');
      expect(args).toContain('-p');
      expect(args).toContain('5432');
      expect(args).toContain('-U');
      expect(args).toContain('postgres');
      return SAMPLE_OUTPUT;
    };

    const result = (await databasesList(undefined, mockExec)) as DatabasesListResult;
    expect(result.count).toBe(3);
  });

  it('passes custom host/port/user', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(args).toContain('db.example.com');
      expect(args).toContain('5433');
      expect(args).toContain('admin');
      return SAMPLE_OUTPUT;
    };

    await databasesList({ host: 'db.example.com', port: 5433, user: 'admin' }, mockExec);
  });
});
