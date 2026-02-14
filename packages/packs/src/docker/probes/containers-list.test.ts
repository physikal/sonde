import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { ContainersListResult } from './containers-list.js';
import { containersList, parseContainersList } from './containers-list.js';

const SAMPLE_OUTPUT = `{"Command":"\\"docker-entrypoint.s…\\"","CreatedAt":"2024-01-15 10:30:00 +0000 UTC","ID":"abc123def456","Image":"nginx:latest","Labels":"","LocalVolumes":"0","Mounts":"","Names":"web-server","Networks":"bridge","Ports":"0.0.0.0:80-\\u003e80/tcp","RunningFor":"2 hours ago","Size":"0B","State":"running","Status":"Up 2 hours"}
{"Command":"\\"postgres\\"","CreatedAt":"2024-01-15 09:00:00 +0000 UTC","ID":"789xyz000111","Image":"postgres:16","Labels":"","LocalVolumes":"1","Mounts":"pgdata","Names":"db","Networks":"bridge","Ports":"5432/tcp","RunningFor":"3 hours ago","Size":"0B","State":"exited","Status":"Exited (0) 1 hour ago"}`;

describe('parseContainersList', () => {
  it('parses docker ps JSON output into structured data', () => {
    const result = parseContainersList(SAMPLE_OUTPUT);

    expect(result.containers).toHaveLength(2);
    expect(result.containers[0]).toEqual({
      id: 'abc123def456',
      name: 'web-server',
      image: 'nginx:latest',
      state: 'running',
      status: 'Up 2 hours',
      ports: '0.0.0.0:80->80/tcp',
    });
    expect(result.containers[1]).toEqual({
      id: '789xyz000111',
      name: 'db',
      image: 'postgres:16',
      state: 'exited',
      status: 'Exited (0) 1 hour ago',
      ports: '5432/tcp',
    });
  });

  it('returns empty array for empty output', () => {
    const result = parseContainersList('');
    expect(result.containers).toHaveLength(0);
  });
});

describe('containersList handler', () => {
  it('calls docker ps with correct args and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('docker');
      expect(args).toEqual(['ps', '-a', '--format', 'json']);
      return SAMPLE_OUTPUT;
    };

    const result = (await containersList(undefined, mockExec)) as ContainersListResult;
    expect(result.containers).toHaveLength(2);
    expect(result.containers[0]?.name).toBe('web-server');
  });
});
