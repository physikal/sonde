import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { ConfigTestResult } from './config-test.js';
import { configTest, parseConfigTest } from './config-test.js';

const SUCCESS_OUTPUT = 'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful';

describe('parseConfigTest', () => {
  it('parses successful config test', () => {
    const result = parseConfigTest(SUCCESS_OUTPUT, true);
    expect(result.valid).toBe(true);
    expect(result.output).toContain('syntax is ok');
  });

  it('parses failed config test', () => {
    const result = parseConfigTest('nginx: [emerg] unexpected "}" in /etc/nginx/nginx.conf:42', false);
    expect(result.valid).toBe(false);
    expect(result.output).toContain('unexpected');
  });
});

describe('configTest handler', () => {
  it('calls nginx -t and returns success', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('nginx');
      expect(args).toEqual(['-t']);
      return SUCCESS_OUTPUT;
    };

    const result = (await configTest(undefined, mockExec)) as ConfigTestResult;
    expect(result.valid).toBe(true);
  });

  it('handles config error gracefully', async () => {
    const mockExec: ExecFn = async () => {
      throw new Error('nginx: [emerg] unknown directive');
    };

    const result = (await configTest(undefined, mockExec)) as ConfigTestResult;
    expect(result.valid).toBe(false);
    expect(result.output).toContain('unknown directive');
  });
});
