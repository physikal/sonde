import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { TracerouteResult } from './traceroute.js';
import {
  parseTracerouteOutput,
  traceroute,
} from './traceroute.js';

const LINUX_TRACEROUTE = `traceroute to 8.8.8.8 (8.8.8.8), 30 hops max, 60 byte packets
 1  192.168.1.1  1.234 ms  1.100 ms  1.050 ms
 2  10.0.0.1  5.432 ms  5.300 ms  5.200 ms
 3  * * *
 4  172.16.0.1  15.678 ms  15.500 ms  15.400 ms
 5  8.8.8.8  20.123 ms  20.050 ms  19.900 ms`;

const MACOS_TRACEROUTE = `traceroute to 1.1.1.1 (1.1.1.1), 30 hops max, 60 byte packets
 1  192.168.0.1  2.345 ms  2.100 ms  2.050 ms
 2  * * *
 3  1.1.1.1  10.567 ms  10.400 ms  10.300 ms`;

const ALL_TIMEOUT = `traceroute to 10.0.0.99 (10.0.0.99), 5 hops max, 60 byte packets
 1  * * *
 2  * * *
 3  * * *`;

describe('parseTracerouteOutput', () => {
  it('parses Linux traceroute with mixed hops', () => {
    const result = parseTracerouteOutput(
      LINUX_TRACEROUTE,
      '8.8.8.8',
    );

    expect(result.host).toBe('8.8.8.8');
    expect(result.hops).toHaveLength(5);

    // Hop 1: normal response
    expect(result.hops[0]?.hop).toBe(1);
    expect(result.hops[0]?.ip).toBe('192.168.1.1');
    expect(result.hops[0]?.rttMs).toEqual([1.234, 1.1, 1.05]);

    // Hop 3: all timeouts
    expect(result.hops[2]?.hop).toBe(3);
    expect(result.hops[2]?.ip).toBeNull();
    expect(result.hops[2]?.rttMs).toEqual([null, null, null]);

    // Hop 5: destination
    expect(result.hops[4]?.hop).toBe(5);
    expect(result.hops[4]?.ip).toBe('8.8.8.8');
    expect(result.hops[4]?.rttMs).toEqual([20.123, 20.05, 19.9]);
  });

  it('parses macOS traceroute output', () => {
    const result = parseTracerouteOutput(
      MACOS_TRACEROUTE,
      '1.1.1.1',
    );

    expect(result.host).toBe('1.1.1.1');
    expect(result.hops).toHaveLength(3);
    expect(result.hops[0]?.ip).toBe('192.168.0.1');
    expect(result.hops[1]?.ip).toBeNull();
    expect(result.hops[2]?.ip).toBe('1.1.1.1');
  });

  it('handles all-timeout output', () => {
    const result = parseTracerouteOutput(
      ALL_TIMEOUT,
      '10.0.0.99',
    );

    expect(result.hops).toHaveLength(3);
    for (const hop of result.hops) {
      expect(hop.ip).toBeNull();
      expect(hop.rttMs).toEqual([null, null, null]);
    }
  });

  it('handles empty output', () => {
    const result = parseTracerouteOutput('', '8.8.8.8');
    expect(result.hops).toHaveLength(0);
  });
});

describe('traceroute handler', () => {
  it('throws when host is missing', async () => {
    const mockExec: ExecFn = async () => '';
    await expect(
      traceroute(undefined, mockExec),
    ).rejects.toThrow('Missing required parameter: host');
    await expect(
      traceroute({}, mockExec),
    ).rejects.toThrow('Missing required parameter: host');
  });

  it('passes correct args with defaults', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return LINUX_TRACEROUTE;
    };

    const result = (await traceroute(
      { host: '8.8.8.8' },
      mockExec,
    )) as TracerouteResult;

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe('traceroute');
    expect(calls[0]?.args).toEqual([
      '-n', '-m', '30', '-w', '2', '8.8.8.8',
    ]);
    expect(result.host).toBe('8.8.8.8');
    expect(result.hops).toHaveLength(5);
  });

  it('respects custom maxHops', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return '';
    };

    await traceroute(
      { host: '8.8.8.8', maxHops: 10 },
      mockExec,
    );
    expect(calls[0]?.args).toContain('10');
  });

  it('clamps maxHops to valid range', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return '';
    };

    await traceroute(
      { host: '8.8.8.8', maxHops: 999 },
      mockExec,
    );
    expect(calls[0]?.args).toContain('64');

    await traceroute(
      { host: '8.8.8.8', maxHops: 0 },
      mockExec,
    );
    expect(calls[1]?.args).toContain('1');
  });
});
