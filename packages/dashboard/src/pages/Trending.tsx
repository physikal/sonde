import { useCallback, useEffect, useRef, useState } from 'react';

import { apiFetch } from '../lib/api';

interface ProbeBreakdown {
  probe: string;
  total: number;
  success: number;
  error: number;
  timeout: number;
  failureRate: number;
  avgDurationMs: number;
}

interface AgentBreakdown {
  agentOrSource: string;
  sourceType: string;
  total: number;
  failures: number;
  failureRate: number;
}

interface HourlyBucket {
  hour: string;
  total: number;
  failures: number;
}

interface RecentError {
  timestamp: string;
  probe: string;
  agentOrSource: string;
  status: string;
  errorMessage: string | null;
  durationMs: number;
}

interface TrendingResponse {
  window: { sinceHours: number; since: string; until: string };
  totalProbes: number;
  totalFailures: number;
  failureRate: number;
  byProbe: ProbeBreakdown[];
  byAgent: AgentBreakdown[];
  byHour: HourlyBucket[];
  recentErrors: RecentError[];
}

interface AnalysisStatus {
  active: boolean;
  complete: boolean;
  hours?: number;
  text?: string;
}

const HOUR_OPTIONS = [1, 6, 12, 24] as const;

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color ?? 'text-white'}`}>{value}</p>
    </div>
  );
}

function FailureBar({
  label,
  failures,
  total,
  rate,
  subtitle,
}: {
  label: string;
  failures: number;
  total: number;
  rate: number;
  subtitle?: string;
}) {
  const pct = total > 0 ? (failures / total) * 100 : 0;
  const successPct = 100 - pct;
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-mono text-gray-300 truncate max-w-[60%]">{label}</span>
        <span className="text-gray-500 whitespace-nowrap ml-2">
          {failures}/{total} failed ({rate}%)
          {subtitle ? ` ${subtitle}` : ''}
        </span>
      </div>
      <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-gray-800">
        <div className="bg-emerald-600 transition-all" style={{ width: `${successPct}%` }} />
        {pct > 0 && <div className="bg-red-500 transition-all" style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}

function HourlySparkline({ data }: { data: HourlyBucket[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-gray-600">No data</div>
    );
  }

  const maxTotal = Math.max(...data.map((d) => d.total), 1);

  return (
    <div className="flex h-24 items-end gap-px">
      {data.map((bucket) => {
        const totalPct = (bucket.total / maxTotal) * 100;
        const failPct = bucket.total > 0 ? (bucket.failures / bucket.total) * 100 : 0;
        const successH = totalPct * (1 - failPct / 100);
        const failH = totalPct * (failPct / 100);
        const time = bucket.hour.slice(11, 16);

        return (
          <div
            key={bucket.hour}
            className="group relative flex flex-1 flex-col items-stretch justify-end"
            title={`${time} — ${bucket.total} probes, ${bucket.failures} failures`}
          >
            {failH > 0 && (
              <div className="w-full rounded-t bg-red-500/80" style={{ height: `${failH}%` }} />
            )}
            <div
              className={`w-full bg-emerald-600/60 ${failH > 0 ? '' : 'rounded-t'}`}
              style={{ height: `${successH}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function formatTime(iso: string): string {
  return iso.slice(11, 19);
}

const STATUS_COLORS: Record<string, string> = {
  error: 'text-red-400',
  timeout: 'text-amber-400',
  unauthorized: 'text-orange-400',
};

function AnalysisPanel({
  text,
  streaming,
  onClose,
}: {
  text: string;
  streaming: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const textLenRef = useRef(0);

  // Auto-scroll when new text arrives during streaming
  if (streaming && text.length !== textLenRef.current && panelRef.current) {
    panelRef.current.scrollTop = panelRef.current.scrollHeight;
  }
  textLenRef.current = text.length;

  return (
    <div className="mt-6 rounded-lg border border-blue-800/50 bg-gray-900 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-blue-400">AI Analysis</h2>
          {streaming && (
            <span className="inline-block h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Close
        </button>
      </div>
      <div
        ref={panelRef}
        className="max-h-96 overflow-y-auto text-sm text-gray-300 whitespace-pre-wrap font-mono leading-relaxed"
      >
        {text || (streaming ? 'Analyzing...' : '')}
        {streaming && (
          <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
    </div>
  );
}

export function Trending() {
  const [data, setData] = useState<TrendingResponse | null>(null);
  const [hours, setHours] = useState<number>(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // AI analysis state
  const [aiConfigured, setAiConfigured] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisText, setAnalysisText] = useState('');
  const [showAnalysis, setShowAnalysis] = useState(false);

  const fetchTrending = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<TrendingResponse>(`/trending?hours=${hours}`)
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [hours]);

  // Check AI config status and existing analysis on mount
  useEffect(() => {
    apiFetch<{ configured: boolean }>('/settings/ai/status')
      .then((res) => setAiConfigured(res.configured))
      .catch(() => {});

    apiFetch<AnalysisStatus>('/trending/analyze/status')
      .then((status) => {
        if (status.complete && status.text) {
          setAnalysisText(status.text);
          setShowAnalysis(true);
        } else if (status.active) {
          streamAnalysis();
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchTrending();
    const interval = setInterval(fetchTrending, 30_000);
    return () => clearInterval(interval);
  }, [fetchTrending]);

  async function streamAnalysis() {
    setAnalyzing(true);
    setAnalysisText('');
    setShowAnalysis(true);

    try {
      const res = await fetch(`/api/v1/trending/analyze?hours=${hours}`, {
        method: 'POST',
        credentials: 'same-origin',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        setAnalysisText(`Error: ${body.error ?? res.statusText}`);
        setAnalyzing(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setAnalysisText('Error: No response stream');
        setAnalyzing(false);
        return;
      }

      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setAnalysisText(accumulated);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Stream failed';
      setAnalysisText((prev) => `${prev}\n\nError: ${msg}`);
    } finally {
      setAnalyzing(false);
    }
  }

  const handleAnalyze = () => {
    streamAnalysis();
  };

  if (loading && !data) {
    return <div className="flex h-64 items-center justify-center text-gray-400">Loading...</div>;
  }

  if (error && !data) {
    return (
      <div className="p-8">
        <p className="text-red-400">{error}</p>
        <button
          type="button"
          onClick={fetchTrending}
          className="mt-2 rounded bg-gray-800 px-3 py-1 text-sm text-gray-300 hover:bg-gray-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const failureColor =
    data.failureRate > 20
      ? 'text-red-400'
      : data.failureRate > 5
        ? 'text-amber-400'
        : 'text-emerald-400';

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Trending</h1>
          <p className="mt-1 text-sm text-gray-500">
            Probe activity from the last {hours} hour
            {hours > 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-700 overflow-hidden">
            {HOUR_OPTIONS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHours(h)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  hours === h ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {h}h
              </button>
            ))}
          </div>
          {aiConfigured && (
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={analyzing}
              className="rounded-lg border border-blue-700 bg-blue-600/10 px-3 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-600/20 transition-colors disabled:opacity-50"
            >
              {analyzing ? 'Analyzing...' : 'Activate AI'}
            </button>
          )}
          <button
            type="button"
            onClick={fetchTrending}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        <StatCard label="Total Probes" value={String(data.totalProbes)} />
        <StatCard
          label="Failures"
          value={String(data.totalFailures)}
          color={data.totalFailures > 0 ? 'text-red-400' : 'text-emerald-400'}
        />
        <StatCard label="Failure Rate" value={`${data.failureRate}%`} color={failureColor} />
      </div>

      {/* AI Analysis panel */}
      {showAnalysis && (
        <AnalysisPanel
          text={analysisText}
          streaming={analyzing}
          onClose={() => {
            setShowAnalysis(false);
            setAnalysisText('');
          }}
        />
      )}

      {/* Hourly sparkline */}
      <div className="mt-6 rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h2 className="mb-3 text-sm font-medium text-gray-400">Volume Over Time</h2>
        <HourlySparkline data={data.byHour} />
        {data.byHour.length > 0 && (
          <div className="mt-1 flex justify-between text-[10px] text-gray-600">
            <span>{data.byHour[0]?.hour.slice(11, 16)}</span>
            <span>{data.byHour[data.byHour.length - 1]?.hour.slice(11, 16)}</span>
          </div>
        )}
      </div>

      {/* Probe and agent breakdowns */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h2 className="mb-3 text-sm font-medium text-gray-400">Probes by Failure Rate</h2>
          {data.byProbe.length === 0 ? (
            <p className="text-sm text-gray-600">No probe data</p>
          ) : (
            data.byProbe
              .slice(0, 10)
              .map((p) => (
                <FailureBar
                  key={p.probe}
                  label={p.probe}
                  failures={p.total - p.success}
                  total={p.total}
                  rate={p.failureRate}
                  subtitle={`avg ${p.avgDurationMs}ms`}
                />
              ))
          )}
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h2 className="mb-3 text-sm font-medium text-gray-400">Targets by Failure Rate</h2>
          {data.byAgent.length === 0 ? (
            <p className="text-sm text-gray-600">No target data</p>
          ) : (
            data.byAgent
              .slice(0, 10)
              .map((a) => (
                <FailureBar
                  key={a.agentOrSource}
                  label={`${a.agentOrSource}${a.sourceType === 'integration' ? ' [int]' : ''}`}
                  failures={a.failures}
                  total={a.total}
                  rate={a.failureRate}
                />
              ))
          )}
        </div>
      </div>

      {/* Recent errors */}
      <div className="mt-6 rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h2 className="mb-3 text-sm font-medium text-gray-400">Recent Errors</h2>
        {data.recentErrors.length === 0 ? (
          <p className="text-sm text-gray-600">
            No errors in the last {hours} hour{hours > 1 ? 's' : ''}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2 pr-4 font-medium">Time</th>
                  <th className="pb-2 pr-4 font-medium">Probe</th>
                  <th className="pb-2 pr-4 font-medium">Target</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Duration</th>
                  <th className="pb-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {data.recentErrors.map((e, i) => (
                  <tr key={`${e.timestamp}-${i}`} className="border-t border-gray-800">
                    <td className="py-2 pr-4 font-mono text-gray-400">{formatTime(e.timestamp)}</td>
                    <td className="py-2 pr-4 font-mono text-gray-300">{e.probe}</td>
                    <td className="py-2 pr-4 text-gray-300">{e.agentOrSource}</td>
                    <td className={`py-2 pr-4 ${STATUS_COLORS[e.status] ?? 'text-gray-400'}`}>
                      {e.status}
                    </td>
                    <td className="py-2 pr-4 text-gray-500">{e.durationMs}ms</td>
                    <td className="py-2 max-w-xs truncate text-gray-500">
                      {e.errorMessage ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
