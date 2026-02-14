import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiKeyGate } from '../components/common/ApiKeyGate';
import { authFetch } from '../hooks/useApiKey';

interface ApiKey {
  id: string;
  name: string;
  policyJson: string;
  revokedAt: string | null;
}

interface Policy {
  allowedAgents?: string[];
  allowedProbes?: string[];
  maxCapabilityLevel?: string;
}

export function Policies() {
  return <ApiKeyGate>{(apiKey) => <PoliciesInner apiKey={apiKey} />}</ApiKeyGate>;
}

function PoliciesInner({ apiKey }: { apiKey: string }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchKeys = useCallback(() => {
    authFetch<{ keys: ApiKey[] }>('/api-keys', apiKey).then((data) => setKeys(data.keys));
  }, [apiKey]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const activeKeys = keys.filter((k) => !k.revokedAt);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white">Policies</h1>
      <p className="mt-1 text-sm text-gray-400">
        Configure per-key access policies. Policies restrict which agents and probes a key can
        access.
      </p>

      <div className="mt-6 space-y-4">
        {activeKeys.length === 0 ? (
          <p className="text-gray-500">No active API keys to configure.</p>
        ) : (
          activeKeys.map((k) => (
            <div key={k.id} className="rounded-xl border border-gray-800 bg-gray-900 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">{k.name}</h3>
                <button
                  type="button"
                  onClick={() => setEditingId(editingId === k.id ? null : k.id)}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  {editingId === k.id ? 'Cancel' : 'Edit Policy'}
                </button>
              </div>
              <PolicySummary policyJson={k.policyJson} />
              {editingId === k.id && (
                <PolicyEditor
                  keyId={k.id}
                  policyJson={k.policyJson}
                  apiKey={apiKey}
                  onSaved={() => {
                    setEditingId(null);
                    fetchKeys();
                  }}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PolicySummary({ policyJson }: { policyJson: string }) {
  const policy = safeParse(policyJson);
  const agents = (policy.allowedAgents as string[] | undefined) ?? [];
  const probes = (policy.allowedProbes as string[] | undefined) ?? [];
  const cap = (policy.maxCapabilityLevel as string | undefined) ?? null;

  return (
    <div className="mt-3 flex flex-wrap gap-2 text-xs">
      <span className="rounded bg-gray-800 px-2 py-1 text-gray-400">
        Agents: {agents.length > 0 ? agents.join(', ') : 'all'}
      </span>
      <span className="rounded bg-gray-800 px-2 py-1 text-gray-400">
        Probes: {probes.length > 0 ? probes.join(', ') : 'all'}
      </span>
      <span className="rounded bg-gray-800 px-2 py-1 text-gray-400">
        Max capability: {cap ?? 'unlimited'}
      </span>
    </div>
  );
}

function PolicyEditor({
  keyId,
  policyJson,
  apiKey,
  onSaved,
}: {
  keyId: string;
  policyJson: string;
  apiKey: string;
  onSaved: () => void;
}) {
  const policy = safeParse(policyJson);
  const [agents, setAgents] = useState((policy.allowedAgents as string[])?.join(', ') ?? '');
  const [probes, setProbes] = useState((policy.allowedProbes as string[])?.join(', ') ?? '');
  const [capLevel, setCapLevel] = useState((policy.maxCapabilityLevel as string) ?? '');
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
    if (capLevel) newPolicy.maxCapabilityLevel = capLevel;

    authFetch(`/api-keys/${keyId}/policy`, apiKey, {
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
    <form onSubmit={handleSave} className="mt-4 space-y-3 border-t border-gray-800 pt-4">
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
        <p className="text-xs font-medium text-gray-500 uppercase mb-1">Max Capability Level</p>
        <select
          value={capLevel}
          onChange={(e) => setCapLevel(e.target.value)}
          className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
        >
          <option value="">Unlimited</option>
          <option value="observe">Observe (read-only)</option>
          <option value="interact">Interact</option>
          <option value="manage">Manage (full)</option>
        </select>
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
