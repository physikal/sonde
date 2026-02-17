import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useToast } from '../components/common/Toast';
import { apiFetch } from '../lib/api';

interface ApiKey {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  policyJson: string;
  lastUsedAt: string | null;
}

export function ApiKeys() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newAgentScope, setNewAgentScope] = useState('');
  const [newProbeScope, setNewProbeScope] = useState('');
  const [newCapLevel, setNewCapLevel] = useState('');
  const [createdKey, setCreatedKey] = useState<{ id: string; key: string; name: string } | null>(
    null,
  );
  const [creating, setCreating] = useState(false);

  const fetchKeys = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<{ keys: ApiKey[] }>('/api-keys')
      .then((data) => setKeys(data.keys))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load API keys';
        setError(msg);
        toast(msg, 'error');
      })
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setCreating(true);

    const policy: Record<string, unknown> = {};
    const agentList = newAgentScope
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const probeList = newProbeScope
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (agentList.length > 0) policy.allowedAgents = agentList;
    if (probeList.length > 0) policy.allowedProbes = probeList;
    if (newCapLevel) policy.maxCapabilityLevel = newCapLevel;

    apiFetch<{ id: string; key: string; name: string }>('/api-keys', {
      method: 'POST',
      body: JSON.stringify({
        name: newKeyName.trim(),
        ...(Object.keys(policy).length > 0 ? { policy } : {}),
      }),
    })
      .then((data) => {
        setCreatedKey(data);
        setNewKeyName('');
        setNewAgentScope('');
        setNewProbeScope('');
        setNewCapLevel('');
        setShowCreate(false);
        fetchKeys();
        toast(`API key "${data.name}" created`, 'success');
      })
      .catch((err: unknown) =>
        toast(err instanceof Error ? err.message : 'Failed to create key', 'error'),
      )
      .finally(() => setCreating(false));
  };

  const handleRevoke = (id: string) => {
    apiFetch(`/api-keys/${id}`, { method: 'DELETE' })
      .then(() => {
        fetchKeys();
        toast('API key revoked', 'success');
      })
      .catch((err: unknown) =>
        toast(err instanceof Error ? err.message : 'Failed to revoke key', 'error'),
      );
  };

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-white">API Keys</h1>
        <p className="mt-4 text-red-400">{error}</p>
        <button
          type="button"
          onClick={fetchKeys}
          className="mt-2 rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">API Keys</h1>
          <p className="mt-1 text-sm text-gray-400">
            {keys.filter((k) => !k.revokedAt).length} active key
            {keys.filter((k) => !k.revokedAt).length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Create Key
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mt-4 space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4"
        >
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase mb-1">Key Name</p>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. claude-desktop"
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">
                Agent Scope (comma-separated)
              </p>
              <input
                type="text"
                value={newAgentScope}
                onChange={(e) => setNewAgentScope(e.target.value)}
                placeholder="e.g. prod-server-1, staging"
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">
                Probe Scope (glob patterns)
              </p>
              <input
                type="text"
                value={newProbeScope}
                onChange={(e) => setNewProbeScope(e.target.value)}
                placeholder="e.g. system.*, docker.*"
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Max Capability</p>
              <select
                value={newCapLevel}
                onChange={(e) => setNewCapLevel(e.target.value)}
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="">Unlimited</option>
                <option value="observe">Observe</option>
                <option value="interact">Interact</option>
                <option value="manage">Manage</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={creating || !newKeyName.trim()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </form>
      )}

      {/* Newly created key (shown once) */}
      {createdKey && (
        <div className="mt-4 rounded-xl border border-amber-800 bg-amber-950/30 p-5">
          <p className="text-sm font-medium text-amber-300">Key created: {createdKey.name}</p>
          <p className="mt-1 text-xs text-amber-400/70">
            Copy this key now. It will not be shown again.
          </p>
          <code className="mt-2 block rounded-lg bg-gray-800 px-4 py-2.5 text-sm text-gray-200 font-mono break-all">
            {createdKey.key}
          </code>
          <button
            type="button"
            onClick={() => setCreatedKey(null)}
            className="mt-3 text-xs text-gray-500 hover:text-gray-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Keys table */}
      <div className="mt-6 overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Policy</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Last Used</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No API keys created yet.
                </td>
              </tr>
            ) : (
              keys.map((k) => {
                const policy = safeParse(k.policyJson);
                const isRevoked = !!k.revokedAt;
                return (
                  <tr key={k.id} className="bg-gray-950">
                    <td className="px-4 py-3 font-medium text-white">{k.name}</td>
                    <td className="px-4 py-3">
                      {isRevoked ? (
                        <span className="text-red-400">revoked</span>
                      ) : (
                        <span className="text-emerald-400">active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {describePolicyBrief(policy)}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(k.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {k.lastUsedAt ? relativeTime(k.lastUsedAt) : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      {!isRevoked && (
                        <button
                          type="button"
                          onClick={() => handleRevoke(k.id)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function describePolicyBrief(policy: Record<string, unknown>): string {
  const parts: string[] = [];
  if (Array.isArray(policy.allowedAgents) && policy.allowedAgents.length > 0) {
    parts.push(`${policy.allowedAgents.length} agent(s)`);
  }
  if (Array.isArray(policy.allowedProbes) && policy.allowedProbes.length > 0) {
    parts.push(`${policy.allowedProbes.length} probe pattern(s)`);
  }
  if (policy.maxCapabilityLevel) {
    parts.push(`cap: ${policy.maxCapabilityLevel}`);
  }
  return parts.length > 0 ? parts.join(' \u00B7 ') : 'No restrictions';
}
