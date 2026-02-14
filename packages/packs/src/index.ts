import { systemPack } from './system/index.js';
import type { Pack } from './types.js';

export type { ExecFn, Pack, ProbeHandler } from './types.js';
export { systemPack } from './system/index.js';

/** Registry of all built-in packs, keyed by pack name */
export const packRegistry: ReadonlyMap<string, Pack> = new Map([
  [systemPack.manifest.name, systemPack],
]);
