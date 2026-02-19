import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { QuerySlowResult } from './query-slow.js';
import { parseQuerySlow, querySlow } from './query-slow.js';

const SAMPLE_OUTPUT =
  '9876\tmyapp\tappuser\t5432\tactive\tSELECT * FROM large_table WHERE expensive_join';

describe('parseQuerySlow', () => {
  it('parses slow queries', () => {
    const result = parseQuerySlow(SAMPLE_OUTPUT, 1000);
    expect(result.count).toBe(1);
    expect(result.thresholdMs).toBe(1000);
    expect(result.queries[0]?.pid).toBe(9876);
    expect(result.queries[0]?.query).toContain('expensive_join');
  });

  it('handles no slow queries', () => {
    const result = parseQuerySlow('', 1000);
    expect(result.count).toBe(0);
    expect(result.queries).toEqual([]);
  });
});

describe('querySlow handler', () => {
  it('calls psql with threshold param', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('psql');
      const query = args[args.length - 1];
      expect(query).toContain('2000');
      return SAMPLE_OUTPUT;
    };

    const result = (await querySlow({ thresholdMs: 2000 }, mockExec)) as QuerySlowResult;
    expect(result.thresholdMs).toBe(2000);
  });
});
