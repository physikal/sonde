import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import { stateList } from './state-list.js';

const SAMPLE_OUTPUT = `aws_instance.web
aws_s3_bucket.logs
aws_vpc.main`;

describe('opentofu stateList handler', () => {
  it('parses resource list from stdout', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('tofu');
      expect(args).toEqual(['state', 'list']);
      return SAMPLE_OUTPUT;
    };

    const result = (await stateList(undefined, mockExec)) as {
      resources: string[];
      count: number;
    };
    expect(result.resources).toEqual([
      'aws_instance.web',
      'aws_s3_bucket.logs',
      'aws_vpc.main',
    ]);
    expect(result.count).toBe(3);
  });

  it('returns empty list for empty output', async () => {
    const mockExec: ExecFn = async () => '';

    const result = (await stateList(undefined, mockExec)) as {
      resources: string[];
      count: number;
    };
    expect(result.resources).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('passes -chdir flag when dir param is provided', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('tofu');
      expect(args).toEqual(['-chdir=/opt/infra', 'state', 'list']);
      return 'aws_instance.web\n';
    };

    const result = (await stateList({ dir: '/opt/infra' }, mockExec)) as {
      resources: string[];
      count: number;
    };
    expect(result.resources).toEqual(['aws_instance.web']);
    expect(result.count).toBe(1);
  });

  it('rejects path traversal in dir parameter', async () => {
    const mockExec: ExecFn = async () => '';

    await expect(
      stateList({ dir: '/opt/../etc/passwd' }, mockExec),
    ).rejects.toThrow('Path traversal not allowed in dir parameter');
  });
});
