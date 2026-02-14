import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { DaemonInfoResult } from './daemon-info.js';
import { daemonInfo, parseDaemonInfo } from './daemon-info.js';

const SAMPLE_OUTPUT = JSON.stringify({
  ServerVersion: '24.0.7',
  Containers: 5,
  ContainersRunning: 3,
  ContainersPaused: 0,
  ContainersStopped: 2,
  Images: 12,
  Driver: 'overlay2',
  OperatingSystem: 'Ubuntu 22.04.3 LTS',
  MemTotal: 16777216000,
  NCPU: 8,
  KernelVersion: '5.15.0-91-generic',
});

describe('parseDaemonInfo', () => {
  it('parses docker info JSON output into structured data', () => {
    const result = parseDaemonInfo(SAMPLE_OUTPUT);

    expect(result).toEqual({
      serverVersion: '24.0.7',
      containers: 5,
      images: 12,
      driver: 'overlay2',
      os: 'Ubuntu 22.04.3 LTS',
      memoryBytes: 16777216000,
      cpus: 8,
    });
  });
});

describe('daemonInfo handler', () => {
  it('calls docker info with correct args and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('docker');
      expect(args).toEqual(['info', '--format', 'json']);
      return SAMPLE_OUTPUT;
    };

    const result = (await daemonInfo(undefined, mockExec)) as DaemonInfoResult;
    expect(result.serverVersion).toBe('24.0.7');
    expect(result.cpus).toBe(8);
  });
});
