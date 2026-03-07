import type { ProbeHandler } from '../../types.js';

function validateDir(dir: string): void {
  if (dir.includes('..')) {
    throw new Error('Path traversal not allowed in dir parameter');
  }
}

export const showJson: ProbeHandler = async (params, exec) => {
  const args: string[] = [];
  if (params?.dir) {
    const dir = String(params.dir);
    validateDir(dir);
    args.push(`-chdir=${dir}`);
  }
  args.push('show', '-json');
  const stdout = await exec('tofu', args);
  return JSON.parse(stdout);
};
