import type { Pack } from './types.js';

export class PackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackValidationError';
  }
}

/**
 * Validates that a pack's handlers match its manifest probes exactly.
 * - Every probe in manifest must have a handler keyed as `{packName}.{probeName}`
 * - No extra handlers may exist beyond what the manifest declares
 */
export function validatePack(pack: Pack): void {
  const packName = pack.manifest.name;
  const expectedKeys = new Set(pack.manifest.probes.map((p) => `${packName}.${p.name}`));
  const actualKeys = new Set(Object.keys(pack.handlers));

  // Check for missing handlers
  for (const key of expectedKeys) {
    if (!actualKeys.has(key)) {
      throw new PackValidationError(`Pack "${packName}": missing handler for probe "${key}"`);
    }
  }

  // Check for extra handlers
  for (const key of actualKeys) {
    if (!expectedKeys.has(key)) {
      throw new PackValidationError(`Pack "${packName}": extra handler "${key}" not in manifest`);
    }
  }
}

/**
 * Validates all packs and builds a frozen registry map.
 * Throws on duplicate pack names or invalid packs.
 */
export function createPackRegistry(packs: Pack[]): ReadonlyMap<string, Pack> {
  const registry = new Map<string, Pack>();

  for (const pack of packs) {
    validatePack(pack);

    if (registry.has(pack.manifest.name)) {
      throw new PackValidationError(`Duplicate pack name: "${pack.manifest.name}"`);
    }
    registry.set(pack.manifest.name, pack);
  }

  return registry;
}
