import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket';
import { apiFetch } from '../lib/api';

interface Agent {
  id: string;
  name: string;
  status: string;
  lastSeen: string;
  os: string;
  agentVersion: string;
  packs: Array<{ name: string; version: string; status: string }>;
}

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

const STATUS_COLORS: Record<string, string> = {
  online: 'bg-emerald-400',
  offline: 'bg-gray-500',
  degraded: 'bg-amber-400',
};

const STATUS_TEXT_COLORS: Record<string, string> = {
  online: 'text-emerald-400',
  offline: 'text-gray-400',
  degraded: 'text-amber-400',
};

const PROBE_STATUS_COLORS: Record<string, string> = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  timeout: 'text-amber-400',
};

export function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { agentStatus } = useWebSocket();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    apiFetch<Agent>(`/agents/${id}`)
      .then(setAgent)
      .catch(() => setError('Agent not found'));
    apiFetch<{ entries: AuditEntry[] }>(`/agents/${id}/audit?limit=50`).then((data) =>
      setAudit(data.entries),
    );
  }, [id]);

  if (error) {
    return (
      <div className="p-8">
        <button
          type="button"
          onClick={() => navigate('/agents')}
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          &larr; Back to Fleet
        </button>
        <p className="mt-4 text-gray-400">{error}</p>
      </div>
    );
  }

  if (!agent) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  const isOnline =
    agentStatus.onlineAgentIds.includes(agent.id) ||
    agentStatus.onlineAgents.some((a) => a.name === agent.name);
  const liveStatus = isOnline ? 'online' : agent.status === 'degraded' ? 'degraded' : 'offline';

  return (
    <div className="p-8">
      <button
        type="button"
        onClick={() => navigate('/agents')}
        className="text-sm text-blue-400 hover:text-blue-300"
      >
        &larr; Back to Fleet
      </button>

      {/* Agent info card */}
      <div className="mt-4 rounded-xl border border-gray-800 bg-gray-900 p-6">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-3 w-3 rounded-full ${STATUS_COLORS[liveStatus] ?? 'bg-gray-500'}`}
          />
          <h1 className="text-xl font-semibold text-white">{agent.name}</h1>
          <span className={`text-sm ${STATUS_TEXT_COLORS[liveStatus] ?? 'text-gray-400'}`}>
            {liveStatus}
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs uppercase text-gray-500">ID</dt>
            <dd className="mt-0.5 text-sm text-gray-300 font-mono truncate">{agent.id}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-gray-500">OS</dt>
            <dd className="mt-0.5 text-sm text-gray-300">{agent.os || '\u2014'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-gray-500">Version</dt>
            <dd className="mt-0.5 text-sm text-gray-300">{agent.agentVersion || '\u2014'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-gray-500">Last Seen</dt>
            <dd className="mt-0.5 text-sm text-gray-300">
              {new Date(agent.lastSeen).toLocaleString()}
            </dd>
          </div>
        </dl>
      </div>

      {/* Installed packs */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-white">Installed Packs</h2>
        {agent.packs.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No packs reported.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {agent.packs.map((pack) => (
              <span
                key={pack.name}
                className="inline-flex items-center gap-1.5 rounded-md bg-gray-800 px-3 py-1.5 text-sm"
              >
                <span className="text-gray-200">{pack.name}</span>
                <span className="text-gray-500">v{pack.version}</span>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${pack.status === 'loaded' ? 'bg-emerald-400' : 'bg-gray-500'}`}
                />
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Probe history / audit log */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-white">Recent Probes</h2>
        <div className="mt-2 overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-900 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Probe</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {audit.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No probe history yet.
                  </td>
                </tr>
              ) : (
                audit.map((entry) => (
                  <tr key={entry.id} className="bg-gray-950">
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-200">{entry.probe}</td>
                    <td className="px-4 py-3">
                      <span className={PROBE_STATUS_COLORS[entry.status] ?? 'text-gray-400'}>
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
    </div>
  );
}

function truncateJson(json: string): string {
  if (json.length <= 120) return json;
  return `${json.slice(0, 117)}...`;
}
