import type { PackManifest } from '@sonde/shared';
import { describe, expect, it } from 'vitest';
import { type SystemChecker, checkPackPermissions, scanForSoftware } from './scanner.js';

function createMockChecker(overrides: Partial<SystemChecker> = {}): SystemChecker {
  return {
    commandExists: () => false,
    fileExists: () => false,
    serviceExists: () => false,
    ...overrides,
  };
}

const dockerManifest: PackManifest = {
  name: 'docker',
  version: '0.1.0',
  description: 'Docker probes',
  requires: { groups: ['docker'], files: [], commands: ['docker'] },
  probes: [],
  detect: { commands: ['docker'] },
};

const systemdManifest: PackManifest = {
  name: 'systemd',
  version: '0.1.0',
  description: 'systemd probes',
  requires: { groups: [], files: [], commands: ['systemctl'] },
  probes: [],
  detect: { files: ['/run/systemd/system'] },
};

const noDetectManifest: PackManifest = {
  name: 'custom',
  version: '0.1.0',
  description: 'No detect rules',
  requires: { groups: [], files: [], commands: [] },
  probes: [],
};

describe('scanForSoftware', () => {
  it('detects software when command exists', () => {
    const checker = createMockChecker({
      commandExists: (cmd) => cmd === 'docker',
    });

    const results = scanForSoftware([dockerManifest], checker);

    expect(results).toHaveLength(1);
    expect(results[0]?.detected).toBe(true);
    expect(results[0]?.matchedCommands).toEqual(['docker']);
  });

  it('detects software when file exists', () => {
    const checker = createMockChecker({
      fileExists: (p) => p === '/run/systemd/system',
    });

    const results = scanForSoftware([systemdManifest], checker);

    expect(results).toHaveLength(1);
    expect(results[0]?.detected).toBe(true);
    expect(results[0]?.matchedFiles).toEqual(['/run/systemd/system']);
  });

  it('marks as not detected when no checks pass', () => {
    const checker = createMockChecker();

    const results = scanForSoftware([dockerManifest], checker);

    expect(results[0]?.detected).toBe(false);
    expect(results[0]?.matchedCommands).toEqual([]);
  });

  it('handles manifests without detect rules', () => {
    const checker = createMockChecker();

    const results = scanForSoftware([noDetectManifest], checker);

    expect(results[0]?.detected).toBe(false);
  });

  it('scans multiple manifests', () => {
    const checker = createMockChecker({
      commandExists: (cmd) => cmd === 'docker',
      fileExists: () => false,
    });

    const results = scanForSoftware([dockerManifest, systemdManifest, noDetectManifest], checker);

    expect(results).toHaveLength(3);
    expect(results[0]?.detected).toBe(true);
    expect(results[1]?.detected).toBe(false);
    expect(results[2]?.detected).toBe(false);
  });
});

describe('checkPackPermissions', () => {
  it('returns satisfied when all requirements met', () => {
    const checker = createMockChecker({
      commandExists: () => true,
      fileExists: () => true,
    });

    const result = checkPackPermissions(dockerManifest, checker, ['docker']);

    expect(result.satisfied).toBe(true);
    expect(result.missingGroups).toEqual([]);
    expect(result.missingCommands).toEqual([]);
  });

  it('reports missing groups', () => {
    const checker = createMockChecker({
      commandExists: () => true,
    });

    const result = checkPackPermissions(dockerManifest, checker, []);

    expect(result.satisfied).toBe(false);
    expect(result.missingGroups).toEqual(['docker']);
  });

  it('reports missing commands', () => {
    const checker = createMockChecker({
      commandExists: () => false,
    });

    const result = checkPackPermissions(dockerManifest, checker, ['docker']);

    expect(result.satisfied).toBe(false);
    expect(result.missingCommands).toEqual(['docker']);
  });

  it('reports missing files', () => {
    const manifest: PackManifest = {
      name: 'test',
      version: '0.1.0',
      description: 'Test',
      requires: { groups: [], files: ['/etc/special.conf'], commands: [] },
      probes: [],
    };
    const checker = createMockChecker({ fileExists: () => false });

    const result = checkPackPermissions(manifest, checker, []);

    expect(result.satisfied).toBe(false);
    expect(result.missingFiles).toEqual(['/etc/special.conf']);
  });

  it('returns satisfied for packs with no requirements', () => {
    const result = checkPackPermissions(noDetectManifest, createMockChecker(), []);

    expect(result.satisfied).toBe(true);
  });
});
