import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import { showJson } from './show-json.js';

const SAMPLE_OUTPUT = JSON.stringify({
  format_version: '1.0',
  terraform_version: '1.9.0',
  values: {
    root_module: {
      resources: [
        {
          address: 'aws_instance.web',
          type: 'aws_instance',
          values: { id: 'i-abc123' },
        },
      ],
    },
  },
});

describe('opentofu showJson handler', () => {
  it('calls tofu show -json and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('tofu');
      expect(args).toEqual(['show', '-json']);
      return SAMPLE_OUTPUT;
    };

    const result = (await showJson(undefined, mockExec)) as Record<
      string,
      unknown
    >;
    expect(result.format_version).toBe('1.0');
    expect(result.terraform_version).toBe('1.9.0');
  });

  it('passes -chdir flag when dir param is provided', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('tofu');
      expect(args).toEqual(['-chdir=/opt/infra', 'show', '-json']);
      return SAMPLE_OUTPUT;
    };

    await showJson({ dir: '/opt/infra' }, mockExec);
  });

  it('rejects path traversal in dir parameter', async () => {
    const mockExec: ExecFn = async () => '';

    await expect(
      showJson({ dir: '../../../etc' }, mockExec),
    ).rejects.toThrow('Path traversal not allowed in dir parameter');
  });
});
