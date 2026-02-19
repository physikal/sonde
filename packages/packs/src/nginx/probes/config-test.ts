import type { ProbeHandler } from '../../types.js';

export interface ConfigTestResult {
  valid: boolean;
  output: string;
}

export const configTest: ProbeHandler = async (_params, exec) => {
  try {
    const stdout = await exec('nginx', ['-t']);
    return parseConfigTest(stdout, true);
  } catch (err) {
    // nginx -t writes to stderr and exits non-zero on failure
    const message = err instanceof Error ? err.message : String(err);
    return parseConfigTest(message, false);
  }
};

export function parseConfigTest(output: string, valid: boolean): ConfigTestResult {
  return {
    valid,
    output: output.trim(),
  };
}
