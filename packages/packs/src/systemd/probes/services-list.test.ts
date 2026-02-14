import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { ServicesListResult } from './services-list.js';
import { parseServicesList, servicesList } from './services-list.js';

const SAMPLE_OUTPUT = JSON.stringify([
  {
    unit: 'nginx.service',
    load: 'loaded',
    active: 'active',
    sub: 'running',
    description: 'A high performance web server',
  },
  {
    unit: 'postgresql.service',
    load: 'loaded',
    active: 'inactive',
    sub: 'dead',
    description: 'PostgreSQL RDBMS',
  },
]);

describe('parseServicesList', () => {
  it('parses systemctl JSON output into structured data', () => {
    const result = parseServicesList(SAMPLE_OUTPUT);

    expect(result.services).toHaveLength(2);
    expect(result.services[0]).toEqual({
      unit: 'nginx.service',
      load: 'loaded',
      active: 'active',
      sub: 'running',
      description: 'A high performance web server',
    });
    expect(result.services[1]).toEqual({
      unit: 'postgresql.service',
      load: 'loaded',
      active: 'inactive',
      sub: 'dead',
      description: 'PostgreSQL RDBMS',
    });
  });

  it('handles empty array', () => {
    const result = parseServicesList('[]');
    expect(result.services).toHaveLength(0);
  });
});

describe('servicesList handler', () => {
  it('calls systemctl with correct args and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('systemctl');
      expect(args).toEqual([
        'list-units',
        '--type=service',
        '--all',
        '--no-pager',
        '--output=json',
      ]);
      return SAMPLE_OUTPUT;
    };

    const result = (await servicesList(undefined, mockExec)) as ServicesListResult;
    expect(result.services).toHaveLength(2);
    expect(result.services[0]?.unit).toBe('nginx.service');
  });
});
