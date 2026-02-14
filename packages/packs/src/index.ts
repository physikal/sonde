import { dockerPack } from './docker/index.js';
import { systemPack } from './system/index.js';
import { systemdPack } from './systemd/index.js';
import type { Pack } from './types.js';
import { createPackRegistry } from './validation.js';

export type { ExecFn, Pack, ProbeHandler } from './types.js';
export { systemPack } from './system/index.js';
export { dockerPack } from './docker/index.js';
export { systemdPack } from './systemd/index.js';
export { createPackRegistry, PackValidationError, validatePack } from './validation.js';

/** Registry of all built-in packs, keyed by pack name */
export const packRegistry: ReadonlyMap<string, Pack> = createPackRegistry([
  systemPack,
  dockerPack,
  systemdPack,
]);
