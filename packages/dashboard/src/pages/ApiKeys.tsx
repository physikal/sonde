import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiKeyGate } from '../components/common/ApiKeyGate';
import { authFetch } from '../hooks/useApiKey';

interface ApiKey {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  policyJson: string;
}

export function ApiKeys() {
  return <ApiKeyGate>{(apiKey) => <ApiKeysInner apiKey={apiKey} />}</ApiKeyGate>;
}

function ApiKeysInner({ apiKey }: { apiKey: string }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<{ id: string; key: string; name: string } | null>(
    null,
  );
  const [creating, setCreating] = useState(false);

  const fetchKeys = useCallback(() => {
    authFetch<{ keys: ApiKey[] }>('/api-keys', apiKey).then((data) => setKeys(data.keys));
  }, [apiKey]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setCreating(true);
    authFetch<{ id: string; key: string; name: string }>('/api-keys', apiKey, {
      method: 'POST',
      body: JSON.stringify({ name: newKeyName.trim() }),
    })
      .then((data) => {
        setCreatedKey(data);
        setNewKeyName('');
        setShowCreate(false);
        fetchKeys();
      })
      .finally(() => setCreating(false));
  };

  const handleRevoke = (id: string) => {
    authFetch(`/api-keys/${id}`, apiKey, { method: 'DELETE' }).then(() => fetchKeys());
  };

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
          className="mt-4 flex items-end gap-3 rounded-xl border border-gray-800 bg-gray-900 p-4"
        >
          <div className="flex-1">
            <p className="text-xs font-medium text-gray-500 uppercase mb-1">Key Name</p>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. claude-desktop"
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
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
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {keys.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
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
