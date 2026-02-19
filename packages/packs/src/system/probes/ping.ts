import { platform } from 'node:os';
import type { ProbeHandler } from '../../types.js';

export interface PingResult {
  host: string;
  packetsTransmitted: number;
  packetsReceived: number;
  packetLossPercent: number;
  rttMs?: {
    min: number;
    avg: number;
    max: number;
    stddev: number;
  };
}

/**
 * Pings a remote host and returns packet loss and RTT statistics.
 * Cross-platform: uses -W (Linux) or -t (macOS) for per-packet timeout.
 */
export const ping: ProbeHandler = async (params, exec) => {
  const host = params?.host as string | undefined;
  if (!host) {
    throw new Error('Missing required parameter: host');
  }

  const count = Math.min(
    Math.max(Number(params?.count ?? 4), 1),
    20,
  );

  const isMac = platform() === 'darwin';
  const timeoutFlag = isMac ? '-t' : '-W';

  const output = await exec('ping', [
    '-c',
    String(count),
    timeoutFlag,
    '3',
    host,
  ]);

  return parsePingOutput(output, host);
};

export function parsePingOutput(
  raw: string,
  host: string,
): PingResult {
  const result: PingResult = {
    host,
    packetsTransmitted: 0,
    packetsReceived: 0,
    packetLossPercent: 100,
  };

  // Match "X packets transmitted, Y received" or "Y packets received"
  const statsMatch = raw.match(
    /(\d+)\s+packets?\s+transmitted,\s+(\d+)\s+(?:packets?\s+)?received/,
  );
  if (statsMatch) {
    result.packetsTransmitted = Number(statsMatch[1]);
    result.packetsReceived = Number(statsMatch[2]);
  }

  // Match "X% packet loss"
  const lossMatch = raw.match(
    /([\d.]+)%\s+packet\s+loss/,
  );
  if (lossMatch) {
    result.packetLossPercent = Number(lossMatch[1]);
  }

  // Match RTT line: "min/avg/max/stddev = X/X/X/X ms"
  // or "min/avg/max/mdev = X/X/X/X ms" (Linux)
  const rttMatch = raw.match(
    /=\s+([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)\s+ms/,
  );
  if (rttMatch) {
    result.rttMs = {
      min: Number(rttMatch[1]),
      avg: Number(rttMatch[2]),
      max: Number(rttMatch[3]),
      stddev: Number(rttMatch[4]),
    };
  }

  return result;
}
