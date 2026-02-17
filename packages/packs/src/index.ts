import { dockerPack } from './docker/index.js';
import { mysqlPack } from './mysql/index.js';
import { nginxPack } from './nginx/index.js';
import { postgresPack } from './postgres/index.js';
import { redisPack } from './redis/index.js';
import { PACK_SIGNATURES } from './signatures.js';
import { systemPack } from './system/index.js';
import { systemdPack } from './systemd/index.js';
import type { Pack } from './types.js';
import { createPackRegistry } from './validation.js';

export type { ExecFn, Pack, ProbeHandler } from './types.js';
export type { PackRegistryOptions } from './validation.js';
export { systemPack } from './system/index.js';
export { dockerPack } from './docker/index.js';
export { systemdPack } from './systemd/index.js';
export { nginxPack } from './nginx/index.js';
export { postgresPack } from './postgres/index.js';
export { redisPack } from './redis/index.js';
export { mysqlPack } from './mysql/index.js';
export { createPackRegistry, PackValidationError, validatePack } from './validation.js';
export { httpbinPack } from './integrations/httpbin.js';

/** Inject stored signatures into pack manifests */
function injectSignatures(packs: Pack[]): Pack[] {
  return packs.map((pack) => {
    const sig = PACK_SIGNATURES[pack.manifest.name];
    if (sig) {
      return {
        ...pack,
        manifest: { ...pack.manifest, signature: sig },
      };
    }
    return pack;
  });
}

/** Registry of all built-in packs, keyed by pack name */
export const packRegistry: ReadonlyMap<string, Pack> = createPackRegistry(
  injectSignatures([systemPack, dockerPack, systemdPack, nginxPack, postgresPack, redisPack, mysqlPack]),
  { allowUnsignedPacks: true },
);
