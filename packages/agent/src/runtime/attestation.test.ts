import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../config.js';
import { generateAttestation, hashConfig, hashFile } from './attestation.js';
import { ProbeExecutor } from './executor.js';

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    hubUrl: 'http://localhost:3000',
    apiKey: 'test-key',
    agentName: 'test-agent',
    ...overrides,
  };
}

function makeExecutor(): ProbeExecutor {
  return new ProbeExecutor(new Map());
}

describe('generateAttestation', () => {
  it('returns all required fields', () => {
    const att = generateAttestation(makeConfig(), makeExecutor());
    expect(att).toHaveProperty('osVersion');
    expect(att).toHaveProperty('binaryHash');
    expect(att).toHaveProperty('installedPacks');
    expect(att).toHaveProperty('configHash');
    expect(att).toHaveProperty('nodeVersion');
  });

  it('osVersion contains platform info', () => {
    const att = generateAttestation(makeConfig(), makeExecutor());
    expect(att.osVersion).toContain(process.platform);
  });

  it('nodeVersion matches process.version', () => {
    const att = generateAttestation(makeConfig(), makeExecutor());
    expect(att.nodeVersion).toBe(process.version);
  });

  it('installedPacks reflects loaded packs', () => {
    const att = generateAttestation(makeConfig(), makeExecutor());
    // Empty map → no packs
    expect(att.installedPacks).toEqual([]);
  });
});

describe('hashConfig', () => {
  it('is deterministic for same config', () => {
    const cfg = makeConfig();
    expect(hashConfig(cfg)).toBe(hashConfig(cfg));
  });

  it('ignores apiKey changes', () => {
    const a = hashConfig(makeConfig({ apiKey: 'key-a' }));
    const b = hashConfig(makeConfig({ apiKey: 'key-b' }));
    expect(a).toBe(b);
  });

  it('ignores enrollmentToken changes', () => {
    const a = hashConfig(makeConfig({ enrollmentToken: 'tok-a' }));
    const b = hashConfig(makeConfig({ enrollmentToken: 'tok-b' }));
    expect(a).toBe(b);
  });
});

describe('hashFile', () => {
  it('returns empty string for missing file', () => {
    expect(hashFile('/nonexistent/path/to/file')).toBe('');
  });
});
