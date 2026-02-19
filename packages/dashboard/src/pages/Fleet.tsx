import { useCallback, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { CsvImportModal } from '../components/common/CsvImportModal';
import { TagInput } from '../components/common/TagInput';
import { useToast } from '../components/common/Toast';
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

interface OutdatedInfo {
  latestVersion: string | null;
  outdated: Array<{
    id: string;
    name: string;
    currentVersion: string;
    latestVersion: string;
  }>;
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

function matchesSearch(agent: Agent, query: string): boolean {
  const q = query.toLowerCase();
  return (
    agent.name.toLowerCase().includes(q) ||
    agent.status.toLowerCase().includes(q) ||
    agent.os.toLowerCase().includes(q) ||
    agent.packs.some((p) => p.name.toLowerCase().includes(q)) ||
    agent.tags.some((t) => t.toLowerCase().includes(q))
  );
}

export function Fleet() {
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [outdatedInfo, setOutdatedInfo] = useState<OutdatedInfo>({
    latestVersion: null,
    outdated: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'add' | 'remove' | null>(null);
  const [bulkTagValue, setBulkTagValue] = useState('');
  const [showCsvImport, setShowCsvImport] = useState(false);
  const { agentStatus } = useWebSocket();
  const navigate = useNavigate();

  const fetchAgents = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch<{ agents: Agent[] }>('/agents'),
      apiFetch<OutdatedInfo>('/agents/outdated').catch(() => ({
        latestVersion: null,
        outdated: [],
      })),
    ])
      .then(([agentsData, outdatedData]) => {
        setAgents(agentsData.agents);
        setOutdatedInfo(outdatedData);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load agents'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const outdatedIds = new Set(outdatedInfo.outdated.map((o) => o.id));

  const onlineIds = new Set(agentStatus.onlineAgentIds);
  const onlineNames = new Set(agentStatus.onlineAgents.map((a) => a.name));
  const mergedAgents = agents.map((a) => ({
    ...a,
    status:
      onlineIds.has(a.id) || onlineNames.has(a.name)
        ? 'online'
        : a.status === 'degraded'
          ? 'degraded'
          : 'offline',
  }));

  const filtered = search
    ? mergedAgents.filter((a) => matchesSearch(a, search))
    : mergedAgents;

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((a) => selected.has(a.id));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((a) => a.id)));
    }
  };

  const handleTagAdd = async (agentId: string, tag: string) => {
    try {
      await apiFetch(`/agents/${agentId}/tags`, {
        method: 'PUT',
        body: JSON.stringify({
          tags: [...(agents.find((a) => a.id === agentId)?.tags ?? []), tag],
        }),
      });
      fetchAgents();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to add tag', 'error');
    }
  };

  const handleTagRemove = async (agentId: string, tag: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;
    try {
      await apiFetch(`/agents/${agentId}/tags`, {
        method: 'PUT',
        body: JSON.stringify({
          tags: agent.tags.filter((t) => t !== tag),
        }),
      });
      fetchAgents();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to remove tag', 'error');
    }
  };

  const handleBulkTag = async () => {
    const tag = bulkTagValue.trim();
    if (!tag || selected.size === 0) return;

    try {
      await apiFetch('/agents/tags', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: [...selected],
          ...(bulkAction === 'add' ? { add: [tag] } : { remove: [tag] }),
        }),
      });
      toast(
        `Tag '${tag}' ${bulkAction === 'add' ? 'added to' : 'removed from'} ${selected.size} agent${selected.size !== 1 ? 's' : ''}`,
        'success',
      );
      setBulkAction(null);
      setBulkTagValue('');
      setSelected(new Set());
      fetchAgents();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Bulk tag operation failed', 'error');
    }
  };

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

      {/* Search + bulk actions */}
      <div className="mt-4 flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents..."
          className="w-64 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">
              {selected.size} selected
            </span>
            <button
              type="button"
              onClick={() => {
                setBulkAction('add');
                setBulkTagValue('');
              }}
              className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
            >
              Add Tag
            </button>
            <button
              type="button"
              onClick={() => {
                setBulkAction('remove');
                setBulkTagValue('');
              }}
              className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
            >
              Remove Tag
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowCsvImport(true)}
          className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
        >
          Import CSV
        </button>
      </div>

      {/* Bulk tag input */}
      {bulkAction && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {bulkAction === 'add' ? 'Add' : 'Remove'} tag:
          </span>
          <input
            type="text"
            value={bulkTagValue}
            onChange={(e) => setBulkTagValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleBulkTag();
              if (e.key === 'Escape') setBulkAction(null);
            }}
            placeholder="tag name"
            autoFocus
            className="w-32 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleBulkTag}
            disabled={!bulkTagValue.trim()}
            className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {bulkAction === 'add' ? 'Add' : 'Remove'}
          </button>
          <button
            type="button"
            onClick={() => setBulkAction(null)}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
                />
              </th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Tags</th>
              <th className="px-4 py-3">Packs</th>
              <th className="px-4 py-3">Last Seen</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">OS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  {search ? (
                    'No agents match your search.'
                  ) : (
                    <>
                      No agents enrolled yet. Visit{' '}
                      <NavLink to="/enrollment" className="text-blue-400 hover:text-blue-300">
                        Enrollment
                      </NavLink>{' '}
                      to get started.
                    </>
                  )}
                </td>
              </tr>
            ) : (
              filtered.map((agent) => (
                <tr
                  key={agent.id}
                  onClick={() => navigate(`/agents/${agent.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/agents/${agent.id}`);
                  }}
                  className="cursor-pointer bg-gray-950 transition-colors hover:bg-gray-900"
                >
                  <td className="px-3 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={selected.has(agent.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleSelect(agent.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
                    />
                  </td>
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
                  <td className="px-4 py-3">
                    <TagInput
                      tags={agent.tags}
                      onAdd={(tag) => handleTagAdd(agent.id, tag)}
                      onRemove={(tag) => handleTagRemove(agent.id, tag)}
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {agent.packs.map((p) => p.name).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{timeAgo(agent.lastSeen)}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {agent.agentVersion || '—'}
                    {outdatedIds.has(agent.id) && (
                      <span className="ml-1.5 rounded bg-amber-900/50 px-1.5 py-0.5 text-xs text-amber-400">
                        update available
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{agent.os || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCsvImport && (
        <CsvImportModal
          type="agent"
          onClose={() => setShowCsvImport(false)}
          onImported={fetchAgents}
        />
      )}
    </div>
  );
}
