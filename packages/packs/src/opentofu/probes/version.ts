import type { ProbeHandler } from '../../types.js';

export const version: ProbeHandler = async (_params, exec) => {
  const stdout = await exec('tofu', ['version', '-json']);
  return JSON.parse(stdout);
};
