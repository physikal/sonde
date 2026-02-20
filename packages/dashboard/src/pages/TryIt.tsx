import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useToast } from '../components/common/Toast';
import { apiFetch } from '../lib/api';

interface Agent {
  id: string;
  name: string;
  status: string;
}

interface ProbeParam {
  type: string;
  description: string;
  required: boolean;
  default?: unknown;
}

interface ProbeDef {
  name: string;
  description: string;
  capability: string;
  params?: Record<string, ProbeParam>;
  timeout: number;
}

interface PackDef {
  name: string;
  version: string;
  description: string;
  probes: ProbeDef[];
  runbook: { category: string; probes: string[]; parallel: boolean } | null;
}

interface ProbeResult {
  status: string;
  durationMs: number;
  data?: unknown;
  error?: string;
}

interface DiagnoseResult {
  meta: {
    target: string;
    source: string;
    timestamp: string;
    category: string;
    runbookId: string;
    probesRun: number;
    probesSucceeded: number;
    probesFailed: number;
    durationMs: number;
  };
  probes: Record<string, ProbeResult>;
}

const CAP_COLORS: Record<string, string> = {
  observe: 'bg-emerald-900/40 text-emerald-400 border-emerald-800',
  interact: 'bg-amber-900/40 text-amber-400 border-amber-800',
  manage: 'bg-red-900/40 text-red-400 border-red-800',
};

export function TryIt() {
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [packs, setPacks] = useState<PackDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedAgent, setSelectedAgent] = useState('');
  const [mode, setMode] = useState<'diagnostic' | 'probe'>('diagnostic');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedPack, setSelectedPack] = useState('');
  const [selectedProbe, setSelectedProbe] = useState('');
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  // Execution state
  const [executing, setExecuting] = useState(false);
  const [diagnoseResult, setDiagnoseResult] = useState<DiagnoseResult | null>(null);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [executedProbeName, setExecutedProbeName] = useState('');

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch<{ agents: Agent[] }>('/agents'),
      apiFetch<{ packs: PackDef[] }>('/packs'),
    ])
      .then(([agentData, packData]) => {
        setAgents(agentData.agents);
        setPacks(packData.packs);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load data';
        setError(msg);
        toast(msg, 'error');
      })
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onlineAgents = agents.filter((a) => a.status === 'online');
  const categories = packs
    .filter((p): p is PackDef & { runbook: NonNullable<PackDef['runbook']> } => p.runbook !== null)
    .map((p) => p.runbook);
  const currentPack = packs.find((p) => p.name === selectedPack);
  const currentProbe = currentPack?.probes.find((p) => p.name === selectedProbe);
  const categoryRunbook = categories.find((r) => r.category === selectedCategory);
  const categoryProbes = categoryRunbook
    ? packs.flatMap((p) =>
        p.probes
          .filter((probe) => categoryRunbook.probes.includes(probe.name))
          .map((probe) => ({ ...probe, pack: p.name })),
      )
    : [];

  // Reset dependent selects when pack changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on selectedPack change
  useEffect(() => {
    setSelectedProbe('');
    setParamValues({});
  }, [selectedPack]);

  // Reset params when probe changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on selectedProbe change
  useEffect(() => {
    setParamValues({});
  }, [selectedProbe]);

  const handleExecute = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedAgent) {
      toast('Select an agent first', 'error');
      return;
    }

    setExecuting(true);
    setDiagnoseResult(null);
    setProbeResult(null);

    if (mode === 'diagnostic') {
      if (!selectedCategory) {
        toast('Select a category', 'error');
        setExecuting(false);
        return;
      }
      apiFetch<DiagnoseResult>('/diagnose', {
        method: 'POST',
        body: JSON.stringify({ agent: selectedAgent, category: selectedCategory }),
      })
        .then((data) => {
          setDiagnoseResult(data);
          toast(
            `Diagnostic complete: ${data.meta.probesSucceeded}/${data.meta.probesRun} passed`,
            data.meta.probesFailed > 0 ? 'error' : 'success',
          );
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Diagnostic failed';
          toast(msg, 'error');
        })
        .finally(() => setExecuting(false));
    } else {
      if (!selectedProbe || !selectedPack) {
        toast('Select a pack and probe', 'error');
        setExecuting(false);
        return;
      }
      const qualifiedName = `${selectedPack}.${selectedProbe}`;
      const params: Record<string, unknown> = {};
      if (currentProbe?.params) {
        for (const [key, def] of Object.entries(currentProbe.params)) {
          const val = paramValues[key];
          if (val !== undefined && val !== '') {
            if (def.type === 'number') params[key] = Number(val);
            else if (def.type === 'boolean') params[key] = val === 'true';
            else params[key] = val;
          }
        }
      }

      setExecutedProbeName(qualifiedName);
      apiFetch<ProbeResult>('/probe', {
        method: 'POST',
        body: JSON.stringify({
          agent: selectedAgent,
          probe: qualifiedName,
          ...(Object.keys(params).length > 0 ? { params } : {}),
        }),
      })
        .then((data) => {
          setProbeResult(data);
          toast(`Probe ${qualifiedName} completed`, data.status === 'error' ? 'error' : 'success');
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Probe failed';
          toast(msg, 'error');
        })
        .finally(() => setExecuting(false));
    }
  };

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-white">Try It</h1>
        <p className="mt-4 text-red-400">{error}</p>
        <button
          type="button"
          onClick={fetchData}
          className="mt-2 rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white">Try It</h1>
      <p className="mt-1 text-sm text-gray-400">
        Run probes and diagnostics against your agents without an AI client.
      </p>

      {/* Configuration */}
      <form
        onSubmit={handleExecute}
        className="mt-6 space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5"
      >
        {/* Agent select */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Agent</p>
          {onlineAgents.length === 0 ? (
            <p className="text-sm text-gray-500">No agents online. Enroll an agent first.</p>
          ) : (
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="">Select an agent...</option>
              {onlineAgents.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Mode toggle */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Mode</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('diagnostic')}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                mode === 'diagnostic'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              Run Diagnostic
            </button>
            <button
              type="button"
              onClick={() => setMode('probe')}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                mode === 'probe'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              Single Probe
            </button>
          </div>
        </div>

        {/* Diagnostic mode */}
        {mode === 'diagnostic' && (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Category</p>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="">Select a category...</option>
                {categories.map((r) => (
                  <option key={r.category} value={r.category}>
                    {r.category} ({r.probes.length} probes, {r.parallel ? 'parallel' : 'sequential'}
                    )
                  </option>
                ))}
              </select>
            </div>

            {/* Probe preview */}
            {categoryProbes.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-2">
                  Probes in runbook
                </p>
                <div className="space-y-1.5">
                  {categoryProbes.map((probe) => (
                    <div
                      key={`${probe.pack}.${probe.name}`}
                      className="flex items-center gap-2 rounded-md bg-gray-800/50 px-3 py-2 text-sm"
                    >
                      <span className="text-gray-200">
                        {probe.pack}.{probe.name}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-xs ${
                          CAP_COLORS[probe.capability] ??
                          'bg-gray-800 text-gray-400 border-gray-700'
                        }`}
                      >
                        {probe.capability}
                      </span>
                      <span className="text-xs text-gray-500">{probe.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Single probe mode */}
        {mode === 'probe' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Pack</p>
                <select
                  value={selectedPack}
                  onChange={(e) => setSelectedPack(e.target.value)}
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select a pack...</option>
                  {packs.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} (v{p.version})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Probe</p>
                <select
                  value={selectedProbe}
                  onChange={(e) => setSelectedProbe(e.target.value)}
                  disabled={!selectedPack}
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
                >
                  <option value="">Select a probe...</option>
                  {currentPack?.probes.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Probe params form */}
            {currentProbe?.params && Object.keys(currentProbe.params).length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-2">Parameters</p>
                <div className="space-y-2">
                  {Object.entries(currentProbe.params).map(([key, def]) => (
                    <div key={key}>
                      <p className="text-xs text-gray-400 mb-0.5">
                        {key}
                        {def.required && <span className="text-red-400">*</span>}
                        <span className="ml-1 text-gray-600">({def.type})</span>
                      </p>
                      {def.type === 'boolean' ? (
                        <select
                          value={paramValues[key] ?? ''}
                          onChange={(e) =>
                            setParamValues((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Default</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : (
                        <input
                          type={def.type === 'number' ? 'number' : 'text'}
                          value={paramValues[key] ?? ''}
                          onChange={(e) =>
                            setParamValues((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          placeholder={def.description}
                          className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Probe info */}
            {currentProbe && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span
                  className={`rounded border px-1.5 py-0.5 ${
                    CAP_COLORS[currentProbe.capability] ??
                    'bg-gray-800 text-gray-400 border-gray-700'
                  }`}
                >
                  {currentProbe.capability}
                </span>
                <span>{currentProbe.description}</span>
                <span>Timeout: {currentProbe.timeout}ms</span>
              </div>
            )}
          </div>
        )}

        {/* Execute button */}
        <button
          type="submit"
          disabled={
            executing ||
            !selectedAgent ||
            (mode === 'diagnostic' ? !selectedCategory : !selectedProbe)
          }
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {executing ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Executing...
            </span>
          ) : (
            'Execute'
          )}
        </button>
      </form>

      {/* Results */}
      {diagnoseResult && <DiagnoseResults result={diagnoseResult} />}
      {probeResult && <SingleProbeResult probeName={executedProbeName} result={probeResult} />}
    </div>
  );
}

function DiagnoseResults({ result }: { result: DiagnoseResult }) {
  return (
    <div className="mt-6 space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm">
        <span className="text-gray-400">
          {result.meta.probesRun} probe{result.meta.probesRun !== 1 ? 's' : ''}
        </span>
        <span className="text-emerald-400">{result.meta.probesSucceeded} succeeded</span>
        {result.meta.probesFailed > 0 && (
          <span className="text-red-400">{result.meta.probesFailed} failed</span>
        )}
        <span className="text-gray-500">{result.meta.durationMs}ms total</span>
      </div>

      {/* Per-probe results */}
      {Object.entries(result.probes).map(([probe, finding]) => (
        <ProbeResultCard key={probe} name={probe} result={finding} />
      ))}
    </div>
  );
}

function SingleProbeResult({ probeName, result }: { probeName: string; result: ProbeResult }) {
  return (
    <div className="mt-6">
      <ProbeResultCard name={probeName} result={result} />
    </div>
  );
}

function ProbeResultCard({ name, result }: { name: string; result: ProbeResult }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-white">{name}</span>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              result.status === 'success'
                ? 'bg-emerald-900/40 text-emerald-400'
                : result.status === 'timeout'
                  ? 'bg-amber-900/40 text-amber-400'
                  : 'bg-red-900/40 text-red-400'
            }`}
          >
            {result.status}
          </span>
          <span className="text-xs text-gray-500">{result.durationMs}ms</span>
        </div>
        <span className="text-gray-500 text-xs">{expanded ? 'Collapse' : 'Expand'}</span>
      </button>
      {expanded && (
        <pre className="overflow-x-auto border-t border-gray-800 bg-gray-950 px-4 py-3 text-xs text-gray-300 font-mono">
          {JSON.stringify(result.data ?? result, null, 2)}
        </pre>
      )}
    </div>
  );
}
