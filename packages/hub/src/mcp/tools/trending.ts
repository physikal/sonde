import type { SondeDb, TrendingSummary } from '../../db/index.js';

function formatPercent(rate: number): string {
  return `${rate}%`;
}

export function formatSummaryText(
  summary: TrendingSummary,
  hours: number,
  probeFilter?: string,
  agentFilter?: string,
): string {
  const lines: string[] = [];
  const label = probeFilter
    ? `Probe "${probeFilter}"`
    : agentFilter
      ? `Target "${agentFilter}"`
      : 'All probes';

  lines.push(`Probe Trends — ${label} (last ${hours}h)`);
  lines.push('');
  lines.push(
    `Total: ${summary.totalProbes} | Failures: ${summary.totalFailures} (${formatPercent(summary.failureRate)})`,
  );

  if (summary.byProbe.length > 0) {
    lines.push('');
    lines.push('By Probe:');
    for (const p of summary.byProbe.slice(0, 10)) {
      const failures = p.total - p.success;
      lines.push(
        `  ${p.probe}  — ${failures}/${p.total} failed (${formatPercent(p.failureRate)}) avg ${p.avgDurationMs}ms`,
      );
    }
  }

  if (summary.byAgent.length > 0) {
    lines.push('');
    lines.push('By Target:');
    for (const a of summary.byAgent.slice(0, 10)) {
      const typeLabel = a.sourceType === 'integration' ? ' [integration]' : '';
      lines.push(
        `  ${a.agentOrSource}${typeLabel}  — ${a.failures}/${a.total} failed (${formatPercent(a.failureRate)})`,
      );
    }
  }

  if (summary.byHour.length > 0) {
    lines.push('');
    lines.push('Hourly Volume:');
    const maxTotal = Math.max(...summary.byHour.map((h) => h.total), 1);
    for (const h of summary.byHour) {
      const time = h.hour.slice(11, 16);
      const barLen = Math.ceil((h.total / maxTotal) * 20);
      const bar = '\u2588'.repeat(barLen);
      const spike = h.failures > 0 && h.failures / h.total > 0.2 ? '  *** spike' : '';
      lines.push(`  ${time}  ${bar} ${h.total} probes, ${h.failures} failures${spike}`);
    }
  }

  if (summary.recentErrors.length > 0) {
    lines.push('');
    lines.push(`Recent Errors (${summary.recentErrors.length}):`);
    for (const e of summary.recentErrors.slice(0, 10)) {
      const time = e.timestamp.slice(11, 19);
      const msg = e.errorMessage ? ` — "${e.errorMessage}"` : '';
      lines.push(`  ${time}  ${e.probe} on ${e.agentOrSource}  [${e.status}]${msg}`);
    }
  }

  if (summary.totalProbes === 0) {
    lines.push('');
    lines.push('No probe data in this time window.');
  }

  return lines.join('\n');
}

export function handleTrendingSummary(
  args: { hours?: number; probe?: string; agent?: string },
  db: SondeDb,
): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
} {
  const hours = Math.min(Math.max(args.hours ?? 24, 1), 24);

  if (args.probe) {
    const data = db.getProbeResultsByProbe(args.probe, hours);
    const summary: TrendingSummary = {
      totalProbes: data.total,
      totalFailures: data.total - data.success,
      failureRate: data.failureRate,
      byProbe: [],
      byAgent: data.byAgent.map((a) => ({
        agentOrSource: a.agentOrSource,
        sourceType: 'agent',
        total: a.total,
        failures: a.failures,
        failureRate: a.failureRate,
      })),
      byHour: [],
      recentErrors: data.recentResults
        .filter((r) => r.status !== 'success')
        .map((r) => ({
          timestamp: r.timestamp,
          probe: args.probe as string,
          agentOrSource: r.agentOrSource,
          status: r.status,
          errorMessage: r.errorMessage,
          durationMs: r.durationMs,
        })),
    };
    return {
      content: [
        {
          type: 'text',
          text: formatSummaryText(summary, hours, args.probe),
        },
      ],
    };
  }

  if (args.agent) {
    const data = db.getProbeResultsByAgent(args.agent, hours);
    const summary: TrendingSummary = {
      totalProbes: data.total,
      totalFailures: data.failures,
      failureRate: data.failureRate,
      byProbe: data.byProbe.map((p) => ({
        probe: p.probe,
        total: p.total,
        success: p.total - p.failures,
        error: p.failures,
        timeout: 0,
        failureRate: p.failureRate,
        avgDurationMs: p.avgDurationMs,
      })),
      byAgent: [],
      byHour: [],
      recentErrors: data.recentResults
        .filter((r) => r.status !== 'success')
        .map((r) => ({
          timestamp: r.timestamp,
          probe: r.probe,
          agentOrSource: args.agent as string,
          status: r.status,
          errorMessage: r.errorMessage,
          durationMs: r.durationMs,
        })),
    };
    return {
      content: [
        {
          type: 'text',
          text: formatSummaryText(summary, hours, undefined, args.agent),
        },
      ],
    };
  }

  const summary = db.getTrendingSummary(hours);
  return {
    content: [
      {
        type: 'text',
        text: formatSummaryText(summary, hours),
      },
    ],
  };
}
