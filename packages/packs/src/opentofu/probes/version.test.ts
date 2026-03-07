import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import { version } from './version.js';

const SAMPLE_OUTPUT = JSON.stringify({
  terraform_version: '1.9.0',
  platform: 'linux_amd64',
  provider_selections: {},
  terraform_outdated: false,
});

describe('opentofu version handler', () => {
  it('calls tofu version -json and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('tofu');
      expect(args).toEqual(['version', '-json']);
      return SAMPLE_OUTPUT;
    };

    const result = await version(undefined, mockExec);
    expect(result).toEqual({
      terraform_version: '1.9.0',
      platform: 'linux_amd64',
      provider_selections: {},
      terraform_outdated: false,
    });
  });
});
