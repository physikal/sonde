import {
  type FormEvent,
  Fragment,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
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

interface PackDef {
  name: string;
  type: string;
  probes: Array<{ name: string }>;
}

interface SuggestionMeta {
  label: string;
  type: 'pack' | 'integration';
}

const KNOWN_CLIENTS = ['claude-desktop', 'claude-code', 'cursor', 'windsurf', 'cline', 'continue'];

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

function getPolicyStatus(policyJson: string): 'restricted' | 'unrestricted' {
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

function SuggestionBadge({ meta }: { meta: SuggestionMeta }) {
  const colors =
    meta.type === 'pack' ? 'bg-violet-900/50 text-violet-400' : 'bg-cyan-900/50 text-cyan-400';
  return (
    <span className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${colors}`}>
      {meta.label}
    </span>
  );
}

function TagInput({
  values,
  onChange,
  suggestions,
  placeholder,
  meta,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  suggestions: string[];
  placeholder: string;
  meta?: Map<string, SuggestionMeta>;
}) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = input.trim()
    ? suggestions.filter((s) => {
        if (values.includes(s)) return false;
        const q = input.toLowerCase();
        if (s.toLowerCase().includes(q)) return true;
        const m = meta?.get(s);
        return m ? m.label.toLowerCase().includes(q) : false;
      })
    : suggestions.filter((s) => !values.includes(s));

  const addValue = (val: string) => {
    const trimmed = val.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput('');
    setHighlighted(0);
    inputRef.current?.focus();
  };

  const removeValue = (val: string) => {
    onChange(values.filter((v) => v !== val));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered.length > 0 && highlighted < filtered.length) {
        addValue(filtered[highlighted]);
      } else if (input.trim()) {
        addValue(input);
      }
    } else if (e.key === 'Backspace' && !input && values.length > 0) {
      removeValue(values[values.length - 1]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => (h < filtered.length - 1 ? h + 1 : h));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => (h > 0 ? h - 1 : 0));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: click delegates focus to the inner input which handles keyboard events */}
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 focus-within:border-blue-500"
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-200"
          >
            {v}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeValue(v);
              }}
              className="text-gray-400 hover:text-white"
            >
              x
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setHighlighted(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={values.length === 0 ? placeholder : ''}
          className="min-w-[120px] flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
        />
      </div>
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-gray-700 bg-gray-800 py-1 shadow-lg">
          {filtered.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addValue(s);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ${
                  i === highlighted ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <span>{s}</span>
                {meta?.get(s) && <SuggestionBadge meta={meta.get(s) as SuggestionMeta} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const [agentNames, setAgentNames] = useState<string[]>([]);
  const [probeNames, setProbeNames] = useState<string[]>([]);
  const [probeMeta, setProbeMeta] = useState<Map<string, SuggestionMeta>>(new Map());

  const fetchKeys = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<{ keys: ApiKey[] }>('/api-keys')
      .then((data) => setKeys(data.keys))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load policies';
        setError(msg);
        toast(msg, 'error');
      })
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  useEffect(() => {
    apiFetch<{ agents: Array<{ name: string }> }>('/agents')
      .then((data) => setAgentNames(data.agents.map((a) => a.name)))
      .catch(() => {});
    apiFetch<{ packs: PackDef[] }>('/packs')
      .then((data) => {
        const names: string[] = [];
        const metaMap = new Map<string, SuggestionMeta>();
        for (const pack of data.packs) {
          const isIntegration = pack.type === 'integration';
          for (const probe of pack.probes) {
            names.push(probe.name);
            metaMap.set(probe.name, {
              label: isIntegration ? pack.name : `${pack.name} pack`,
              type: isIntegration ? 'integration' : 'pack',
            });
          }
        }
        setProbeNames(names.sort());
        setProbeMeta(metaMap);
      })
      .catch(() => {});
  }, []);

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
  const filtered = search ? activeKeys.filter((k) => matchesSearch(k, search)) : activeKeys;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white">Policies</h1>
      <p className="mt-1 text-sm text-gray-400">
        Configure per-key access policies. Policies restrict which agents, probes, and clients a key
        can access.
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
          <span className="text-xs text-gray-500">{showHelp ? 'Hide' : 'Show'}</span>
        </button>
        {showHelp && (
          <>
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-gray-800 bg-gray-900 px-4 py-3">
                <dt className="text-sm font-medium text-white">Agents</dt>
                <dd className="mt-1.5 text-sm text-gray-400">
                  Restrict which agents a key can query. Exact name matching. Empty = all agents.
                </dd>
                <dd className="mt-1 text-xs font-mono text-gray-500">prod-server-1, staging-web</dd>
              </div>
              <div className="rounded-md border border-gray-800 bg-gray-900 px-4 py-3">
                <dt className="text-sm font-medium text-white">Probes</dt>
                <dd className="mt-1.5 text-sm text-gray-400">
                  Restrict which probes a key can run. Glob patterns with{' '}
                  <code className="text-gray-300">*</code> wildcard. Empty = all probes.
                </dd>
                <dd className="mt-1 text-xs font-mono text-gray-500">
                  system.*, docker.container.*
                </dd>
              </div>
              <div className="rounded-md border border-gray-800 bg-gray-900 px-4 py-3">
                <dt className="text-sm font-medium text-white">Clients</dt>
                <dd className="mt-1.5 text-sm text-gray-400">
                  Restrict which MCP clients can use a key. Exact client ID matching. Empty = all
                  clients.
                </dd>
                <dd className="mt-1 text-xs font-mono text-gray-500">claude-desktop, cursor</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-gray-500">
              Keys with no restrictions have full diagnostic access. Restrictions are enforced at
              the hub on every probe request.
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
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  {search ? 'No policies match your search.' : 'No active API keys to configure.'}
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
                      <td className="px-4 py-3 font-medium text-white">{k.name}</td>
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
                          onClick={() => setEditingId(isEditing ? null : k.id)}
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
                            agentSuggestions={agentNames}
                            probeSuggestions={probeNames}
                            probeMeta={probeMeta}
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
  agentSuggestions,
  probeSuggestions,
  probeMeta,
  onSaved,
}: {
  keyId: string;
  policyJson: string;
  agentSuggestions: string[];
  probeSuggestions: string[];
  probeMeta: Map<string, SuggestionMeta>;
  onSaved: () => void;
}) {
  const policy = safeParse(policyJson);
  const [agents, setAgents] = useState<string[]>((policy.allowedAgents as string[]) ?? []);
  const [probes, setProbes] = useState<string[]>((policy.allowedProbes as string[]) ?? []);
  const [clients, setClients] = useState<string[]>((policy.allowedClients as string[]) ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const newPolicy: Policy = {};
    if (agents.length > 0) newPolicy.allowedAgents = agents;
    if (probes.length > 0) newPolicy.allowedProbes = probes;
    if (clients.length > 0) newPolicy.allowedClients = clients;

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
          Allowed Agents (empty = all)
        </p>
        <TagInput
          values={agents}
          onChange={setAgents}
          suggestions={agentSuggestions}
          placeholder="Type to search agents..."
        />
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase mb-1">
          Allowed Probes (empty = all)
        </p>
        <TagInput
          values={probes}
          onChange={setProbes}
          suggestions={probeSuggestions}
          placeholder="Type to search probes..."
          meta={probeMeta}
        />
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase mb-1">
          Allowed Clients (empty = all)
        </p>
        <TagInput
          values={clients}
          onChange={setClients}
          suggestions={KNOWN_CLIENTS}
          placeholder="Type to search clients..."
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
