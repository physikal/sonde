import type { ProbeHandler } from '../../types.js';

export interface TracerouteHop {
  hop: number;
  ip: string | null;
  rttMs: (number | null)[];
}

export interface TracerouteResult {
  host: string;
  hops: TracerouteHop[];
}

/**
 * Traces the network path to a host via `traceroute -n`.
 * Works on both Linux and macOS.
 */
export const traceroute: ProbeHandler = async (params, exec) => {
  const host = params?.host as string | undefined;
  if (!host) {
    throw new Error('Missing required parameter: host');
  }

  const maxHops = Math.min(
    Math.max(Number(params?.maxHops ?? 30), 1),
    64,
  );

  const output = await exec('traceroute', [
    '-n',
    '-m',
    String(maxHops),
    '-w',
    '2',
    host,
  ]);

  return parseTracerouteOutput(output, host);
};

export function parseTracerouteOutput(
  raw: string,
  host: string,
): TracerouteResult {
  const hops: TracerouteHop[] = [];
  const lines = raw.trim().split('\n');

  for (const line of lines) {
    // Skip the header line ("traceroute to ...")
    const hopMatch = line.match(/^\s*(\d+)\s+(.+)/);
    if (!hopMatch) continue;

    const hopNum = Number(hopMatch[1]);
    const rest = hopMatch[2] ?? '';

    // All probes timed out: "* * *"
    if (/^\*\s+\*\s+\*\s*$/.test(rest)) {
      hops.push({ hop: hopNum, ip: null, rttMs: [null, null, null] });
      continue;
    }

    const hop = parseHopLine(hopNum, rest);
    hops.push(hop);
  }

  return { host, hops };
}

function parseHopLine(hopNum: number, rest: string): TracerouteHop {
  let ip: string | null = null;
  const rttMs: (number | null)[] = [];

  // Tokenize the rest of the line
  const tokens = rest.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    if (!token || token === '*') {
      rttMs.push(null);
      i++;
    } else if (token === 'ms') {
      // Skip "ms" — already consumed the number
      i++;
    } else if (/^\d+\.\d+\.\d+\.\d+$/.test(token) || token.includes(':')) {
      // IPv4 or IPv6 address
      ip = token;
      i++;
    } else {
      const num = Number.parseFloat(token);
      if (!Number.isNaN(num)) {
        rttMs.push(num);
      }
      i++;
    }
  }

  return { hop: hopNum, ip, rttMs };
}
