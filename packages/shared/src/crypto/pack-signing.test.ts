import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signPackManifest, verifyPackManifest } from './pack-signing.js';

function generateTestKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey: publicKey as string, privateKey: privateKey as string };
}

const testManifest = {
  name: 'system',
  version: '0.1.0',
  description: 'System monitoring probes',
  requires: { groups: [], files: [], commands: [] },
  probes: [
    {
      name: 'disk.usage',
      description: 'Disk usage',
      capability: 'observe',
      timeout: 30000,
    },
  ],
};

describe('pack-signing', () => {
  const { publicKey, privateKey } = generateTestKeypair();

  it('should sign and verify a pack manifest', () => {
    const sig = signPackManifest(testManifest, privateKey);
    expect(sig).toBeTruthy();
    expect(typeof sig).toBe('string');

    const signedManifest = { ...testManifest, signature: sig };
    const valid = verifyPackManifest(signedManifest, publicKey);
    expect(valid).toBe(true);
  });

  it('should reject a tampered manifest', () => {
    const sig = signPackManifest(testManifest, privateKey);
    const tampered = { ...testManifest, signature: sig, version: '9.9.9' };

    const valid = verifyPackManifest(tampered, publicKey);
    expect(valid).toBe(false);
  });

  it('should return false for missing signature', () => {
    const valid = verifyPackManifest(testManifest, publicKey);
    expect(valid).toBe(false);
  });

  it('should return false when no public key is available', () => {
    const sig = signPackManifest(testManifest, privateKey);
    const signedManifest = { ...testManifest, signature: sig };

    // No public key passed and PACK_SIGNING_PUBLIC_KEY is empty
    const valid = verifyPackManifest(signedManifest);
    expect(valid).toBe(false);
  });

  it('should ignore existing signature field when signing', () => {
    const manifestWithSig = { ...testManifest, signature: 'old-sig' };
    const sig = signPackManifest(manifestWithSig, privateKey);

    // Should produce same signature as manifest without signature field
    const sigClean = signPackManifest(testManifest, privateKey);
    expect(sig).toBe(sigClean);
  });
});
