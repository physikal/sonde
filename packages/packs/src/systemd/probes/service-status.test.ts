import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { ServiceStatusResult } from './service-status.js';
import { parseServiceStatus, serviceStatus } from './service-status.js';

const SAMPLE_OUTPUT = `Type=notify
Restart=on-failure
Id=nginx.service
LoadState=loaded
ActiveState=active
SubState=running
MainPID=1234
MemoryCurrent=52428800
NRestarts=2
ExecMainStartTimestamp=Mon 2024-01-15 10:30:00 UTC`;

describe('parseServiceStatus', () => {
  it('parses systemctl show output into structured data', () => {
    const result = parseServiceStatus(SAMPLE_OUTPUT);

    expect(result).toEqual({
      name: 'nginx.service',
      loadState: 'loaded',
      activeState: 'active',
      subState: 'running',
      mainPid: 1234,
      memoryBytes: 52428800,
      restartCount: 2,
    });
  });

  it('handles missing fields with defaults', () => {
    const result = parseServiceStatus('Id=unknown.service\nLoadState=not-found');

    expect(result.name).toBe('unknown.service');
    expect(result.loadState).toBe('not-found');
    expect(result.activeState).toBe('');
    expect(result.mainPid).toBe(0);
    expect(result.memoryBytes).toBe(0);
    expect(result.restartCount).toBe(0);
  });
});

describe('serviceStatus handler', () => {
  it('calls systemctl show with correct args and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('systemctl');
      expect(args).toEqual(['show', 'nginx.service', '--no-pager']);
      return SAMPLE_OUTPUT;
    };

    const result = (await serviceStatus(
      { service: 'nginx.service' },
      mockExec,
    )) as ServiceStatusResult;
    expect(result.name).toBe('nginx.service');
    expect(result.mainPid).toBe(1234);
  });
});
