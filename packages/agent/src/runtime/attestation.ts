import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import type { AttestationData } from '@sonde/shared';
import type { AgentConfig } from '../config.js';
import type { ProbeExecutor } from './executor.js';

/** SHA-256 hex of a file. Returns empty string on any error. */
export function hashFile(filePath: string): string {
  try {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch {
    return '';
  }
}

/** SHA-256 hex of config with sensitive fields stripped, keys sorted for determinism. */
export function hashConfig(config: AgentConfig): string {
  const { apiKey: _, enrollmentToken: _t, ...rest } = config;
  const sorted = JSON.stringify(rest, Object.keys(rest).sort());
  return crypto.createHash('sha256').update(sorted).digest('hex');
}

export function generateAttestation(config: AgentConfig, executor: ProbeExecutor): AttestationData {
  return {
    osVersion: `${os.platform()} ${os.release()} ${os.arch()}`,
    binaryHash: hashFile(process.argv[1] ?? ''),
    installedPacks: executor.getLoadedPacks().map((p) => ({
      name: p.name,
      version: p.version,
    })),
    configHash: hashConfig(config),
    nodeVersion: process.version,
  };
}
