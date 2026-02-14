import { useCallback, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
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

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function Fleet() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { agentStatus } = useWebSocket();
  const navigate = useNavigate();

  const fetchAgents = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<{ agents: Agent[] }>('/agents')
      .then((data) => setAgents(data.agents))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load agents'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Merge real-time online status from WebSocket
  const onlineIds = new Set(agentStatus.onlineAgentIds);
  const mergedAgents = agents.map((a) => ({
    ...a,
    status: onlineIds.has(a.id) ? 'online' : a.status === 'degraded' ? 'degraded' : 'offline',
  }));

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-white">Fleet</h1>
        <p className="mt-4 text-red-400">{error}</p>
        <button
          type="button"
          onClick={fetchAgents}
          className="mt-2 rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white">Fleet</h1>
      <p className="mt-1 text-sm text-gray-400">
        {mergedAgents.length} agent{mergedAgents.length !== 1 ? 's' : ''} registered
        {' \u00B7 '}
        {mergedAgents.filter((a) => a.status === 'online').length} online
      </p>

      <div className="mt-6 overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Packs</th>
              <th className="px-4 py-3">Last Seen</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">OS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {mergedAgents.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No agents enrolled yet. Visit{' '}
                  <NavLink to="/enrollment" className="text-blue-400 hover:text-blue-300">
                    Enrollment
                  </NavLink>{' '}
                  to get started.
                </td>
              </tr>
            ) : (
              mergedAgents.map((agent) => (
                <tr
                  key={agent.id}
                  onClick={() => navigate(`/agents/${agent.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/agents/${agent.id}`);
                  }}
                  className="cursor-pointer bg-gray-950 transition-colors hover:bg-gray-900"
                >
                  <td className="px-4 py-3 font-medium text-white">{agent.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[agent.status] ?? 'bg-gray-500'}`}
                      />
                      <span className={STATUS_TEXT_COLORS[agent.status] ?? 'text-gray-400'}>
                        {agent.status}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {agent.packs.map((p) => p.name).join(', ') || '\u2014'}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{timeAgo(agent.lastSeen)}</td>
                  <td className="px-4 py-3 text-gray-400">{agent.agentVersion || '\u2014'}</td>
                  <td className="px-4 py-3 text-gray-400">{agent.os || '\u2014'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
