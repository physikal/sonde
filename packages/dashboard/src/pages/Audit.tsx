import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface AuditEntry {
  id: number;
  timestamp: string;
  agentId: string;
  probe: string;
  status: string;
  durationMs: number;
  requestJson: string | null;
  responseJson: string | null;
}

interface ChainStatus {
  valid: boolean;
  brokenAt?: number;
}

const STATUS_COLORS: Record<string, string> = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  timeout: 'text-amber-400',
};

export function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [chain, setChain] = useState<ChainStatus | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [filterAgent, setFilterAgent] = useState('');
  const [filterProbe, setFilterProbe] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [limit, setLimit] = useState(100);

  const fetchEntries = useCallback(() => {
    apiFetch<{ entries: AuditEntry[] }>(`/audit?limit=${limit}`).then((data) =>
      setEntries(data.entries),
    );
  }, [limit]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleVerify = () => {
    setVerifying(true);
    apiFetch<ChainStatus>('/audit/verify')
      .then(setChain)
      .finally(() => setVerifying(false));
  };

  // Client-side filtering
  const filtered = entries.filter((e) => {
    if (filterAgent && !e.agentId.toLowerCase().includes(filterAgent.toLowerCase())) return false;
    if (filterProbe && !e.probe.toLowerCase().includes(filterProbe.toLowerCase())) return false;
    if (filterStatus && e.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Audit Log</h1>
          <p className="mt-1 text-sm text-gray-400">{entries.length} entries loaded</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Chain integrity indicator */}
          {chain && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
                chain.valid
                  ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800'
                  : 'bg-red-900/30 text-red-400 border border-red-800'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${chain.valid ? 'bg-emerald-400' : 'bg-red-400'}`}
              />
              {chain.valid ? 'Chain intact' : `Chain broken at #${chain.brokenAt}`}
            </span>
          )}
          <button
            type="button"
            onClick={handleVerify}
            disabled={verifying}
            className="rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            {verifying ? 'Verifying...' : 'Verify Chain'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap gap-3">
        <input
          type="text"
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value)}
          placeholder="Filter by agent ID..."
          className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        <input
          type="text"
          value={filterProbe}
          onChange={(e) => setFilterProbe(e.target.value)}
          placeholder="Filter by probe..."
          className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
        >
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
          <option value="timeout">Timeout</option>
        </select>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
        >
          <option value={50}>Last 50</option>
          <option value={100}>Last 100</option>
          <option value={500}>Last 500</option>
        </select>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        Showing {filtered.length} of {entries.length} entries
      </p>

      {/* Audit table */}
      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Probe</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No audit entries found.
                </td>
              </tr>
            ) : (
              filtered.map((entry) => (
                <tr key={entry.id} className="bg-gray-950">
                  <td className="px-4 py-3 text-gray-500 text-xs">{entry.id}</td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">
                    {entry.agentId.slice(0, 8)}...
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-200">{entry.probe}</td>
                  <td className="px-4 py-3">
                    <span className={STATUS_COLORS[entry.status] ?? 'text-gray-400'}>
                      {entry.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{entry.durationMs}ms</td>
                  <td className="max-w-xs truncate px-4 py-3 text-gray-500 font-mono text-xs">
                    {entry.responseJson ? truncateJson(entry.responseJson) : '\u2014'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function truncateJson(json: string): string {
  if (json.length <= 100) return json;
  return `${json.slice(0, 97)}...`;
}
