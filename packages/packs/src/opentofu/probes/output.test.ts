import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import { output } from './output.js';

const SAMPLE_OUTPUT = JSON.stringify({
  instance_ip: { value: '10.0.1.5', type: 'string', sensitive: false },
  db_password: { value: 'redacted', type: 'string', sensitive: true },
});

describe('opentofu output handler', () => {
  it('calls tofu output -json and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('tofu');
      expect(args).toEqual(['output', '-json']);
      return SAMPLE_OUTPUT;
    };

    const result = (await output(undefined, mockExec)) as Record<
      string,
      { value: string; type: string; sensitive: boolean }
    >;
    expect(result.instance_ip?.value).toBe('10.0.1.5');
    expect(result.db_password?.sensitive).toBe(true);
  });

  it('passes -chdir flag when dir param is provided', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('tofu');
      expect(args).toEqual(['-chdir=/opt/infra', 'output', '-json']);
      return SAMPLE_OUTPUT;
    };

    await output({ dir: '/opt/infra' }, mockExec);
  });

  it('rejects path traversal in dir parameter', async () => {
    const mockExec: ExecFn = async () => '';

    await expect(
      output({ dir: '/opt/../../etc' }, mockExec),
    ).rejects.toThrow('Path traversal not allowed in dir parameter');
  });
});
