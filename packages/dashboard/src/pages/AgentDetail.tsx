import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TagInput } from '../components/common/TagInput';
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
  tags: string[];
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

interface PackDef {
  name: string;
  type: string;
  version: string;
  description: string;
}

interface OutdatedInfo {
  latestVersion: string | null;
  outdated: Array<{ id: string; name: string; currentVersion: string; latestVersion: string }>;
}

export function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { agentStatus } = useWebSocket();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [allAgentPacks, setAllAgentPacks] = useState<PackDef[]>([]);
  const [outdatedInfo, setOutdatedInfo] = useState<OutdatedInfo>({
    latestVersion: null,
    outdated: [],
  });

  const fetchAgent = useCallback(() => {
    if (!id) return;
    apiFetch<Agent>(`/agents/${id}`)
      .then(setAgent)
      .catch(() => setError('Agent not found'));
  }, [id]);

  useEffect(() => {
    fetchAgent();
    if (!id) return;
    apiFetch<{ entries: AuditEntry[] }>(`/agents/${id}/audit?limit=50`).then((data) =>
      setAudit(data.entries),
    );
    apiFetch<OutdatedInfo>('/agents/outdated')
      .then(setOutdatedInfo)
      .catch(() => {});
    apiFetch<{ packs: PackDef[] }>('/packs')
      .then((data) =>
        setAllAgentPacks(data.packs.filter((p) => p.type === 'agent')),
      )
      .catch(() => {});
  }, [id, fetchAgent]);

  const handleTagAdd = async (tag: string) => {
    if (!id || !agent) return;
    await apiFetch(`/agents/${id}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tags: [...agent.tags, tag] }),
    });
    fetchAgent();
  };

  const handleTagRemove = async (tag: string) => {
    if (!id || !agent) return;
    await apiFetch(`/agents/${id}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tags: agent.tags.filter((t) => t !== tag) }),
    });
    fetchAgent();
  };

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
  const agentOutdated = outdatedInfo.outdated.find((o) => o.id === agent.id);

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

      {/* Tags */}
      <div className="mt-4">
        <h2 className="text-sm font-medium text-gray-400 mb-2">Tags</h2>
        <TagInput tags={agent.tags} onAdd={handleTagAdd} onRemove={handleTagRemove} />
      </div>

      {/* Update available banner */}
      {agentOutdated && (
        <div className="mt-4 rounded-xl border border-amber-800/50 bg-amber-900/20 p-4">
          <p className="text-sm text-amber-400">
            Update Available: v{agentOutdated.currentVersion} &rarr; v{agentOutdated.latestVersion}.
            Run <code className="rounded bg-amber-900/50 px-1.5 py-0.5">sonde update</code> on the
            agent to upgrade.
          </p>
        </div>
      )}

      {/* Packs */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-white">Packs</h2>

        {/* Installed */}
        {agent.packs.length > 0 && (
          <div className="mt-3">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1.5">
              Installed
            </p>
            <div className="flex flex-wrap gap-2">
              {agent.packs.map((pack) => (
                <span
                  key={pack.name}
                  className="inline-flex items-center gap-1.5 rounded-md bg-gray-800 px-3 py-1.5 text-sm"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span className="text-gray-200">{pack.name}</span>
                  <span className="text-gray-500">v{pack.version}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Available (not installed) */}
        {(() => {
          const installedNames = new Set(
            agent.packs.map((p) => p.name),
          );
          const available = allAgentPacks.filter(
            (p) => !installedNames.has(p.name),
          );
          if (available.length === 0) return null;
          return (
            <div className="mt-3">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-1.5">
                Available
              </p>
              <div className="flex flex-wrap gap-2">
                {available.map((pack) => (
                  <span
                    key={pack.name}
                    className="inline-flex items-center gap-1.5 rounded-md bg-gray-800/50 px-3 py-1.5 text-sm"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-600" />
                    <span className="text-gray-500">
                      {pack.name}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          );
        })()}

        {agent.packs.length === 0 && allAgentPacks.length === 0 && (
          <p className="mt-2 text-sm text-gray-500">
            No packs reported.
          </p>
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
