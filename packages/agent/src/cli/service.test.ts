import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: { existsSync: vi.fn() },
}));

vi.mock('node:os', () => ({
  default: {
    userInfo: () => ({
      username: 'testuser',
      homedir: '/home/testuser',
    }),
  },
}));

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import {
  generateUnitFile,
  getServiceStatus,
  isServiceInstalled,
} from './service.js';

const mockExec = vi.mocked(execFileSync);
const mockExists = vi.mocked(fs.existsSync);

describe('generateUnitFile', () => {
  it('includes the current user and home directory', () => {
    mockExec.mockReturnValueOnce('/usr/local/bin/sonde\n');
    const unit = generateUnitFile();
    expect(unit).toContain('User=testuser');
    expect(unit).toContain('Environment=HOME=/home/testuser');
  });

  it('includes the resolved sonde binary path', () => {
    mockExec.mockReturnValueOnce('/usr/local/bin/sonde\n');
    const unit = generateUnitFile();
    expect(unit).toContain(
      'ExecStart=/usr/local/bin/sonde start --headless',
    );
  });

  it('sets restart on failure with 5s delay', () => {
    mockExec.mockReturnValueOnce('/usr/bin/sonde\n');
    const unit = generateUnitFile();
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('RestartSec=5');
  });

  it('targets network-online', () => {
    mockExec.mockReturnValueOnce('/usr/bin/sonde\n');
    const unit = generateUnitFile();
    expect(unit).toContain('After=network-online.target');
    expect(unit).toContain('Wants=network-online.target');
  });
});

describe('isServiceInstalled', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
  });

  it('returns false on non-Linux platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(isServiceInstalled()).toBe(false);
  });

  it('returns true when unit file exists on Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    mockExists.mockReturnValueOnce(true);
    expect(isServiceInstalled()).toBe(true);
  });

  it('returns false when unit file is missing on Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    mockExists.mockReturnValueOnce(false);
    expect(isServiceInstalled()).toBe(false);
  });
});

describe('getServiceStatus', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
  });

  it('returns unsupported on non-Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(getServiceStatus()).toBe('unsupported');
  });

  it('returns not-installed when unit file missing', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    mockExists.mockReturnValueOnce(false);
    expect(getServiceStatus()).toBe('not-installed');
  });

  it('returns active status from systemctl', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    mockExists.mockReturnValueOnce(true);
    mockExec.mockReturnValueOnce('active\n');
    expect(getServiceStatus()).toBe('active');
  });

  it('returns inactive when systemctl throws', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    mockExists.mockReturnValueOnce(true);
    mockExec.mockImplementationOnce(() => {
      throw new Error('exit code 3');
    });
    expect(getServiceStatus()).toBe('inactive');
  });
});
