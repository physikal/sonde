import { Fragment, type FormEvent, useCallback, useEffect, useState } from 'react';
import { useToast } from '../components/common/Toast';
import { apiFetch } from '../lib/api';

interface ApiKey {
  id: string;
  name: string;
  policyJson: string;
  revokedAt: string | null;
  role: string;
  lastUsedAt: string | null;
  createdAt: string;
  keyType: 'mcp' | 'agent';
}

interface Policy {
  allowedAgents?: string[];
  allowedProbes?: string[];
  allowedClients?: string[];
}

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

function getPolicyStatus(
  policyJson: string,
): 'restricted' | 'unrestricted' {
  const policy = safeParse(policyJson);
  const agents = (policy.allowedAgents as string[] | undefined) ?? [];
  const probes = (policy.allowedProbes as string[] | undefined) ?? [];
  const clients = (policy.allowedClients as string[] | undefined) ?? [];
  if (agents.length > 0 || probes.length > 0 || clients.length > 0) {
    return 'restricted';
  }
  return 'unrestricted';
}

function getPolicyCounts(policyJson: string) {
  const policy = safeParse(policyJson);
  const agents = (policy.allowedAgents as string[] | undefined) ?? [];
  const probes = (policy.allowedProbes as string[] | undefined) ?? [];
  return { agents: agents.length, probes: probes.length };
}

function matchesSearch(key: ApiKey, query: string): boolean {
  const q = query.toLowerCase();
  const policy = safeParse(key.policyJson);
  const agents = (policy.allowedAgents as string[] | undefined) ?? [];
  const probes = (policy.allowedProbes as string[] | undefined) ?? [];
  const clients = (policy.allowedClients as string[] | undefined) ?? [];
  const status = getPolicyStatus(key.policyJson);
  return (
    key.name.toLowerCase().includes(q) ||
    key.role.toLowerCase().includes(q) ||
    status.includes(q) ||
    agents.some((a) => a.toLowerCase().includes(q)) ||
    probes.some((p) => p.toLowerCase().includes(q)) ||
    clients.some((c) => c.toLowerCase().includes(q))
  );
}

export function Policies() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const fetchKeys = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<{ keys: ApiKey[] }>('/api-keys')
      .then((data) => setKeys(data.keys))
      .catch((err: unknown) => {
        const msg =
          err instanceof Error ? err.message : 'Failed to load policies';
        setError(msg);
        toast(msg, 'error');
      })
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-white">Policies</h1>
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

  const activeKeys = keys.filter((k) => !k.revokedAt);
  const filtered = search
    ? activeKeys.filter((k) => matchesSearch(k, search))
    : activeKeys;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white">Policies</h1>
      <p className="mt-1 text-sm text-gray-400">
        Configure per-key access policies. Policies restrict which agents,
        probes, and clients a key can access.
      </p>

      {/* Educational section */}
      <div className="mt-6 rounded-lg border border-gray-800 bg-gray-900/50 p-5">
        <button
          type="button"
          onClick={() => setShowHelp(!showHelp)}
          className="flex w-full items-center justify-between text-left"
        >
          <h2 className="text-sm font-medium text-gray-300 uppercase tracking-wide">
            Policy dimensions
          </h2>
          <span className="text-xs text-gray-500">
            {showHelp ? 'Hide' : 'Show'}
          </span>
        </button>
        {showHelp && (
          <>
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-gray-800 bg-gray-900 px-4 py-3">
                <dt className="text-sm font-medium text-white">Agents</dt>
                <dd className="mt-1.5 text-sm text-gray-400">
                  Restrict which agents a key can query. Exact name matching.
                  Empty = all agents.
                </dd>
                <dd className="mt-1 text-xs font-mono text-gray-500">
                  prod-server-1, staging-web
                </dd>
              </div>
              <div className="rounded-md border border-gray-800 bg-gray-900 px-4 py-3">
                <dt className="text-sm font-medium text-white">Probes</dt>
                <dd className="mt-1.5 text-sm text-gray-400">
                  Restrict which probes a key can run. Glob patterns with{' '}
                  <code className="text-gray-300">*</code> wildcard. Empty = all
                  probes.
                </dd>
                <dd className="mt-1 text-xs font-mono text-gray-500">
                  system.*, docker.container.*
                </dd>
              </div>
              <div className="rounded-md border border-gray-800 bg-gray-900 px-4 py-3">
                <dt className="text-sm font-medium text-white">Clients</dt>
                <dd className="mt-1.5 text-sm text-gray-400">
                  Restrict which MCP clients can use a key. Exact client ID
                  matching. Empty = all clients.
                </dd>
                <dd className="mt-1 text-xs font-mono text-gray-500">
                  claude-desktop, cursor
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-gray-500">
              Keys with no restrictions have full diagnostic access. Restrictions
              are enforced at the hub on every probe request.
            </p>
          </>
        )}
      </div>

      {/* Search */}
      <div className="mt-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search policies..."
          className="w-64 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Key Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Agents</th>
              <th className="px-4 py-3">Probes</th>
              <th className="px-4 py-3">Last Used</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-gray-500"
                >
                  {search
                    ? 'No policies match your search.'
                    : 'No active API keys to configure.'}
                </td>
              </tr>
            ) : (
              filtered.map((k) => {
                const status = getPolicyStatus(k.policyJson);
                const counts = getPolicyCounts(k.policyJson);
                const isEditing = editingId === k.id;
                return (
                  <Fragment key={k.id}>
                    <tr className="bg-gray-950">
                      <td className="px-4 py-3 font-medium text-white">
                        {k.name}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block rounded-full bg-gray-800 px-2.5 py-1 text-xs font-medium leading-none text-gray-300">
                          {k.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {status === 'unrestricted' ? (
                          <span className="inline-block rounded-full bg-emerald-900/50 px-2.5 py-1 text-xs font-medium leading-none text-emerald-400">
                            unrestricted
                          </span>
                        ) : (
                          <span className="inline-block rounded-full bg-amber-900/50 px-2.5 py-1 text-xs font-medium leading-none text-amber-400">
                            restricted
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {counts.agents > 0 ? counts.agents : 'all'}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {counts.probes > 0 ? counts.probes : 'all'}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'Never'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() =>
                            setEditingId(isEditing ? null : k.id)
                          }
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          {isEditing ? 'Cancel' : 'Edit Policy'}
                        </button>
                      </td>
                    </tr>
                    {isEditing && (
                      <tr className="bg-gray-950">
                        <td colSpan={7} className="px-4 pb-4">
                          <PolicyEditor
                            keyId={k.id}
                            policyJson={k.policyJson}
                            onSaved={() => {
                              setEditingId(null);
                              fetchKeys();
                              toast('Policy saved', 'success');
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PolicyEditor({
  keyId,
  policyJson,
  onSaved,
}: {
  keyId: string;
  policyJson: string;
  onSaved: () => void;
}) {
  const policy = safeParse(policyJson);
  const [agents, setAgents] = useState(
    ((policy.allowedAgents as string[]) ?? []).join(', '),
  );
  const [probes, setProbes] = useState(
    ((policy.allowedProbes as string[]) ?? []).join(', '),
  );
  const [allowedClients, setAllowedClients] = useState(
    ((policy.allowedClients as string[]) ?? []).join(', '),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const newPolicy: Policy = {};
    const agentList = agents
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const probeList = probes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (agentList.length > 0) newPolicy.allowedAgents = agentList;
    if (probeList.length > 0) newPolicy.allowedProbes = probeList;

    const clientList = allowedClients
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (clientList.length > 0) newPolicy.allowedClients = clientList;

    apiFetch(`/api-keys/${keyId}/policy`, {
      method: 'PUT',
      body: JSON.stringify({ policy: newPolicy }),
    })
      .then(() => onSaved())
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to save');
        setSaving(false);
      });
  };

  return (
    <form onSubmit={handleSave} className="space-y-3 pt-2">
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase mb-1">
          Allowed Agents (comma-separated, empty = all)
        </p>
        <input
          type="text"
          value={agents}
          onChange={(e) => setAgents(e.target.value)}
          placeholder="e.g. prod-server-1, staging-web"
          className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase mb-1">
          Allowed Probes (glob patterns, empty = all)
        </p>
        <input
          type="text"
          value={probes}
          onChange={(e) => setProbes(e.target.value)}
          placeholder="e.g. system.*, docker.container.*"
          className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase mb-1">
          Allowed Clients (comma-separated MCP client IDs)
        </p>
        <input
          type="text"
          value={allowedClients}
          onChange={(e) => setAllowedClients(e.target.value)}
          placeholder="e.g. claude-desktop, cursor"
          className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Policy'}
      </button>
    </form>
  );
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
