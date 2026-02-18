#!/usr/bin/env tsx
/**
 * Signs all built-in pack manifests using the SONDE_PACK_SIGNING_KEY env var.
 * Writes the signatures to packages/packs/src/signatures.ts.
 *
 * Usage: SONDE_PACK_SIGNING_KEY="..." npx tsx scripts/sign-packs.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function main() {
  const privateKey = process.env.SONDE_PACK_SIGNING_KEY;
  if (!privateKey) {
    console.error('Error: SONDE_PACK_SIGNING_KEY environment variable is required');
    process.exit(1);
  }

  // Dynamic import of built packages
  const { signPackManifest } = await import(
    path.join(rootDir, 'packages/shared/dist/crypto/pack-signing.js')
  );
  const { systemPack } = await import(path.join(rootDir, 'packages/packs/dist/system/index.js'));
  const { dockerPack } = await import(path.join(rootDir, 'packages/packs/dist/docker/index.js'));
  const { systemdPack } = await import(path.join(rootDir, 'packages/packs/dist/systemd/index.js'));

  const packs = [systemPack, dockerPack, systemdPack];
  const signatures: Record<string, string> = {};

  for (const pack of packs) {
    const manifest = pack.manifest;
    const sig = signPackManifest(manifest as Record<string, unknown>, privateKey);
    if (!sig) {
      console.error(`Failed to sign pack: ${manifest.name}`);
      process.exit(1);
    }
    signatures[manifest.name] = sig;
    console.log(`Signed: ${manifest.name} v${manifest.version}`);
  }

  const output = `export const PACK_SIGNATURES: Record<string, string> = ${JSON.stringify(signatures, null, 2)};\n`;

  const outPath = path.join(rootDir, 'packages/packs/src/signatures.ts');
  fs.writeFileSync(outPath, output, 'utf-8');
  console.log(`\nWrote signatures to ${outPath}`);
}

main();
