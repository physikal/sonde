import { describe, expect, it } from 'vitest';
import { checkNotRoot, sondeUserExists, suggestGroupAdd } from './privilege.js';

describe('privilege', () => {
  it('checkNotRoot does not throw for non-root', () => {
    // Tests run as non-root, so this should not exit
    expect(() => checkNotRoot()).not.toThrow();
  });

  it('sondeUserExists returns a boolean', () => {
    const result = sondeUserExists();
    expect(typeof result).toBe('boolean');
  });

  it('suggestGroupAdd returns correct command', () => {
    expect(suggestGroupAdd('docker')).toBe('sudo usermod -aG docker sonde');
    expect(suggestGroupAdd('systemd-journal')).toBe('sudo usermod -aG systemd-journal sonde');
  });

  it('suggestGroupAdd with different groups', () => {
    const cmd = suggestGroupAdd('adm');
    expect(cmd).toContain('adm');
    expect(cmd).toContain('sonde');
  });
});
