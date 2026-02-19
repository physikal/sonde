import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { PingResult } from './ping.js';
import { parsePingOutput, ping } from './ping.js';

const LINUX_OUTPUT = `PING 10.0.0.1 (10.0.0.1) 56(84) bytes of data.
64 bytes from 10.0.0.1: icmp_seq=1 ttl=64 time=0.543 ms
64 bytes from 10.0.0.1: icmp_seq=2 ttl=64 time=0.401 ms
64 bytes from 10.0.0.1: icmp_seq=3 ttl=64 time=0.387 ms
64 bytes from 10.0.0.1: icmp_seq=4 ttl=64 time=0.392 ms

--- 10.0.0.1 ping statistics ---
4 packets transmitted, 4 received, 0% packet loss, time 3005ms
rtt min/avg/max/mdev = 0.387/0.430/0.543/0.065 ms
`;

const MACOS_OUTPUT = `PING 192.168.1.1 (192.168.1.1): 56 data bytes
64 bytes from 192.168.1.1: icmp_seq=0 ttl=64 time=1.234 ms
64 bytes from 192.168.1.1: icmp_seq=1 ttl=64 time=1.456 ms
64 bytes from 192.168.1.1: icmp_seq=2 ttl=64 time=1.123 ms
64 bytes from 192.168.1.1: icmp_seq=3 ttl=64 time=1.345 ms

--- 192.168.1.1 ping statistics ---
4 packets transmitted, 4 packets received, 0.0% packet loss
round-trip min/avg/max/stddev = 1.123/1.289/1.456/0.122 ms
`;

const FULL_LOSS_OUTPUT = `PING 10.99.99.99 (10.99.99.99) 56(84) bytes of data.

--- 10.99.99.99 ping statistics ---
4 packets transmitted, 0 received, 100% packet loss, time 3003ms
`;

const PARTIAL_LOSS_OUTPUT = `PING 10.0.0.5 (10.0.0.5) 56(84) bytes of data.
64 bytes from 10.0.0.5: icmp_seq=1 ttl=64 time=0.500 ms
64 bytes from 10.0.0.5: icmp_seq=3 ttl=64 time=0.600 ms

--- 10.0.0.5 ping statistics ---
4 packets transmitted, 2 received, 50% packet loss, time 3004ms
rtt min/avg/max/mdev = 0.500/0.550/0.600/0.050 ms
`;

describe('parsePingOutput', () => {
  it('parses valid Linux ping output', () => {
    const result = parsePingOutput(LINUX_OUTPUT, '10.0.0.1');

    expect(result.host).toBe('10.0.0.1');
    expect(result.packetsTransmitted).toBe(4);
    expect(result.packetsReceived).toBe(4);
    expect(result.packetLossPercent).toBe(0);
    expect(result.rttMs).toEqual({
      min: 0.387,
      avg: 0.43,
      max: 0.543,
      stddev: 0.065,
    });
  });

  it('parses valid macOS ping output', () => {
    const result = parsePingOutput(MACOS_OUTPUT, '192.168.1.1');

    expect(result.host).toBe('192.168.1.1');
    expect(result.packetsTransmitted).toBe(4);
    expect(result.packetsReceived).toBe(4);
    expect(result.packetLossPercent).toBe(0);
    expect(result.rttMs).toEqual({
      min: 1.123,
      avg: 1.289,
      max: 1.456,
      stddev: 0.122,
    });
  });

  it('handles 100% packet loss', () => {
    const result = parsePingOutput(FULL_LOSS_OUTPUT, '10.99.99.99');

    expect(result.packetsTransmitted).toBe(4);
    expect(result.packetsReceived).toBe(0);
    expect(result.packetLossPercent).toBe(100);
    expect(result.rttMs).toBeUndefined();
  });

  it('handles partial packet loss with RTT', () => {
    const result = parsePingOutput(PARTIAL_LOSS_OUTPUT, '10.0.0.5');

    expect(result.packetsTransmitted).toBe(4);
    expect(result.packetsReceived).toBe(2);
    expect(result.packetLossPercent).toBe(50);
    expect(result.rttMs).toBeDefined();
    expect(result.rttMs?.avg).toBeCloseTo(0.55);
  });
});

describe('ping handler', () => {
  it('throws when host param is missing', async () => {
    const mockExec: ExecFn = async () => '';
    await expect(ping(undefined, mockExec)).rejects.toThrow(
      'Missing required parameter: host',
    );
    await expect(ping({}, mockExec)).rejects.toThrow(
      'Missing required parameter: host',
    );
  });

  it('passes correct args to exec with default count', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return LINUX_OUTPUT;
    };

    const result = (await ping(
      { host: '10.0.0.1' },
      mockExec,
    )) as PingResult;

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe('ping');
    expect(calls[0]?.args).toContain('-c');
    expect(calls[0]?.args).toContain('4');
    expect(calls[0]?.args).toContain('10.0.0.1');
    expect(result.host).toBe('10.0.0.1');
    expect(result.packetsTransmitted).toBe(4);
  });

  it('respects custom count param', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return LINUX_OUTPUT;
    };

    await ping({ host: '10.0.0.1', count: 2 }, mockExec);

    expect(calls[0]?.args).toContain('2');
  });

  it('clamps count to valid range', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return LINUX_OUTPUT;
    };

    await ping({ host: '10.0.0.1', count: 100 }, mockExec);
    expect(calls[0]?.args).toContain('20');

    await ping({ host: '10.0.0.1', count: 0 }, mockExec);
    expect(calls[1]?.args).toContain('1');
  });

  it('handles exec failure (DNS resolution error)', async () => {
    const mockExec: ExecFn = async () => {
      throw new Error(
        'ping: unknown host nosuchhost.invalid',
      );
    };

    await expect(
      ping({ host: 'nosuchhost.invalid' }, mockExec),
    ).rejects.toThrow('unknown host');
  });
});
