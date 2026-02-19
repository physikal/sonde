#!/usr/bin/env tsx
/**
 * One-time utility to generate an RSA 4096-bit keypair for pack signing.
 *
 * Usage: npx tsx scripts/generate-pack-keypair.ts
 *
 * Output:
 *   - Private key: store as CI secret SONDE_PACK_SIGNING_KEY
 *   - Public key: embed in packages/shared/src/crypto/pack-signing.ts as PACK_SIGNING_PUBLIC_KEY
 */
import crypto from 'node:crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 4096,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

console.log('=== PRIVATE KEY (store as SONDE_PACK_SIGNING_KEY secret) ===');
console.log(privateKey);
console.log('');
console.log('=== PUBLIC KEY (embed in pack-signing.ts PACK_SIGNING_PUBLIC_KEY) ===');
console.log(publicKey);
