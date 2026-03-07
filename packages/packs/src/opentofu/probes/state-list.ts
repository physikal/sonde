import type { ProbeHandler } from '../../types.js';

function validateDir(dir: string): void {
  if (dir.includes('..')) {
    throw new Error('Path traversal not allowed in dir parameter');
  }
}

export const stateList: ProbeHandler = async (params, exec) => {
  const args: string[] = [];
  if (params?.dir) {
    const dir = String(params.dir);
    validateDir(dir);
    args.push(`-chdir=${dir}`);
  }
  args.push('state', 'list');
  const stdout = await exec('tofu', args);
  const resources = stdout.trim().split('\n').filter(Boolean);
  return { resources, count: resources.length };
};
