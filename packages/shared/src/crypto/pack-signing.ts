import { signPayload, verifyPayload } from './signing.js';

/**
 * Public key for verifying pack manifest signatures.
 * Populated after running `scripts/generate-pack-keypair.ts`.
 * When empty, verification is skipped (unsigned packs allowed).
 */
export const PACK_SIGNING_PUBLIC_KEY = '';

/**
 * Sign a pack manifest. Strips the `signature` field before signing.
 * Returns a base64-encoded RSA-SHA256 signature.
 */
export function signPackManifest(manifest: Record<string, unknown>, privateKeyPem: string): string {
  const { signature: _, ...rest } = manifest;
  return signPayload(rest, privateKeyPem);
}

/**
 * Verify a pack manifest signature. Strips the `signature` field before verifying.
 * Uses the embedded public key by default, or a provided one.
 * Returns false if signature is missing or verification fails.
 */
export function verifyPackManifest(
  manifest: Record<string, unknown>,
  publicKeyPem?: string,
): boolean {
  const key = publicKeyPem ?? PACK_SIGNING_PUBLIC_KEY;
  if (!key) return false;

  const sig = manifest.signature;
  if (!sig || typeof sig !== 'string') return false;

  const { signature: _, ...rest } = manifest;
  return verifyPayload(rest, sig, key);
}
