import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import { validate } from './validate.js';

const SAMPLE_VALID = JSON.stringify({
  valid: true,
  error_count: 0,
  warning_count: 0,
  diagnostics: [],
});

const SAMPLE_INVALID = JSON.stringify({
  valid: false,
  error_count: 1,
  warning_count: 1,
  diagnostics: [
    {
      severity: 'error',
      summary: 'Missing required argument',
      detail: 'The argument "region" is required.',
    },
  ],
});

describe('opentofu validate handler', () => {
  it('calls tofu validate -json and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('tofu');
      expect(args).toEqual(['validate', '-json']);
      return SAMPLE_VALID;
    };

    const result = (await validate(undefined, mockExec)) as {
      valid: boolean;
      error_count: number;
    };
    expect(result.valid).toBe(true);
    expect(result.error_count).toBe(0);
  });

  it('returns validation errors when config is invalid', async () => {
    const mockExec: ExecFn = async () => SAMPLE_INVALID;

    const result = (await validate(undefined, mockExec)) as {
      valid: boolean;
      error_count: number;
      diagnostics: Array<{ severity: string; summary: string }>;
    };
    expect(result.valid).toBe(false);
    expect(result.error_count).toBe(1);
    expect(result.diagnostics[0]?.severity).toBe('error');
  });

  it('passes -chdir flag when dir param is provided', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('tofu');
      expect(args).toEqual(['-chdir=/opt/infra', 'validate', '-json']);
      return SAMPLE_VALID;
    };

    await validate({ dir: '/opt/infra' }, mockExec);
  });

  it('rejects path traversal in dir parameter', async () => {
    const mockExec: ExecFn = async () => '';

    await expect(
      validate({ dir: '../../secret' }, mockExec),
    ).rejects.toThrow('Path traversal not allowed in dir parameter');
  });
});
