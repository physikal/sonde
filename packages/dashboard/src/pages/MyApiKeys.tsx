import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../components/common/Toast';
import { apiFetch } from '../lib/api';

interface ApiKey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  role: string;
}

export function MyApiKeys() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<{
    id: string;
    key: string;
    name?: string;
  } | null>(null);

  const fetchKeys = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<{ keys: ApiKey[] }>('/my/api-keys')
      .then((data) => setKeys(data.keys))
      .catch((err: unknown) => {
        const msg =
          err instanceof Error ? err.message : 'Failed to load API keys';
        setError(msg);
        toast(msg, 'error');
      })
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = () => {
    setCreating(true);

    apiFetch<{ id: string; key: string; name: string }>('/my/api-keys', {
      method: 'POST',
      body: JSON.stringify({}),
    })
      .then((data) => {
        setCreatedKey(data);
        fetchKeys();
        toast(`API key "${data.name}" created`, 'success');
      })
      .catch((err: unknown) =>
        toast(
          err instanceof Error ? err.message : 'Failed to create key',
          'error',
        ),
      )
      .finally(() => setCreating(false));
  };

  const handleRotate = (id: string) => {
    apiFetch<{ id: string; key: string }>(`/my/api-keys/${id}/rotate`, {
      method: 'POST',
    })
      .then((data) => {
        setCreatedKey(data);
        fetchKeys();
        toast('API key rotated', 'success');
      })
      .catch((err: unknown) =>
        toast(
          err instanceof Error ? err.message : 'Failed to rotate key',
          'error',
        ),
      );
  };

  const handleRevoke = (id: string) => {
    apiFetch(`/my/api-keys/${id}`, { method: 'DELETE' })
      .then(() => {
        fetchKeys();
        toast('API key revoked', 'success');
      })
      .catch((err: unknown) =>
        toast(
          err instanceof Error ? err.message : 'Failed to revoke key',
          'error',
        ),
      );
  };

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-white">My API Keys</h1>
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
          <h1 className="text-2xl font-semibold text-white">My API Keys</h1>
          <p className="mt-1 text-sm text-gray-400">
            {keys.length} active key{keys.length !== 1 ? 's' : ''} (max 5)
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating || keys.length >= 5}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create Key'}
        </button>
      </div>

      <p className="mt-3 text-sm text-gray-400">
        Use these keys to connect AI tools (Claude Desktop, Claude Code) to
        Sonde via MCP. Keys are automatically named with your identity.
      </p>

      {createdKey && (
        <div className="mt-4 rounded-xl border border-amber-800 bg-amber-950/30 p-5">
          <p className="text-sm font-medium text-amber-300">
            {createdKey.name ? `Key created: ${createdKey.name}` : 'Key rotated'}
          </p>
          <p className="mt-1 text-xs text-amber-400/70">
            Save this key now. You won't be able to see it again.
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

      <div className="mt-6 overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Last Used</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {keys.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-gray-500"
                >
                  No API keys yet. Create one to connect your AI tools.
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr key={k.id} className="bg-gray-950">
                  <td className="px-4 py-3 font-medium text-white">
                    {k.name}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {new Date(k.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {k.lastUsedAt ? relativeTime(k.lastUsedAt) : 'Never'}
                  </td>
                  <td className="px-4 py-3 space-x-2">
                    <button
                      type="button"
                      onClick={() => handleRotate(k.id)}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      Rotate
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevoke(k.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Revoke
                    </button>
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
