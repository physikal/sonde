import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useToast } from '../components/common/Toast';
import { apiFetch } from '../lib/api';

interface AccessGroup {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  agents: Array<{ agentPattern: string }>;
  integrations: Array<{ integrationId: string }>;
  users: Array<{ userId: string }>;
}

interface Integration {
  id: string;
  name: string;
  type: string;
}

interface AuthorizedUser {
  id: string;
  email: string;
  displayName: string;
}

export function AccessGroups() {
  const { toast } = useToast();
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchGroups = useCallback(() => {
    setLoading(true);
    apiFetch<{ groups: AccessGroup[] }>('/access-groups')
      .then((data) => setGroups(data.groups))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    setCreating(true);
    try {
      await apiFetch('/access-groups', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() }),
      });
      setNewName('');
      setNewDesc('');
      toast('Access group created', 'success');
      fetchGroups();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create access group';
      toast(msg, 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/access-groups/${id}`, { method: 'DELETE' });
      toast('Access group deleted', 'success');
      if (expanded === id) setExpanded(null);
      fetchGroups();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete access group';
      toast(msg, 'error');
    }
  };

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Access Groups</h1>
        <p className="mt-1 text-sm text-gray-400">
          Scope which agents and integrations users can access. Users with no access group
          assignments can see everything (default open).
        </p>
      </div>

      <form
        onSubmit={handleCreate}
        className="flex items-end gap-3 rounded-lg border border-gray-800 bg-gray-900 p-4"
      >
        <div className="flex-1">
          <label
            htmlFor="newGroupName"
            className="block text-xs font-medium text-gray-400 uppercase"
          >
            Name
          </label>
          <input
            id="newGroupName"
            type="text"
            required
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Desktop Team"
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex-1">
          <label
            htmlFor="newGroupDesc"
            className="block text-xs font-medium text-gray-400 uppercase"
          >
            Description
          </label>
          <input
            id="newGroupDesc"
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Optional description"
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          disabled={creating}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create Group'}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-gray-500">
          No access groups created. All users can see all agents and integrations.
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div
              key={group.id}
              className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden"
            >
              <div className="flex items-center justify-between p-4">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === group.id ? null : group.id)}
                  className="flex-1 text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-white">{group.name}</span>
                    <span className="text-xs text-gray-500">
                      {group.agents.length} agent pattern{group.agents.length !== 1 ? 's' : ''}
                      {' \u00B7 '}
                      {group.integrations.length} integration
                      {group.integrations.length !== 1 ? 's' : ''}
                      {' \u00B7 '}
                      {group.users.length} user{group.users.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {group.description && (
                    <p className="mt-0.5 text-xs text-gray-500">{group.description}</p>
                  )}
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600">
                    {expanded === group.id ? '\u25B2' : '\u25BC'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDelete(group.id)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {expanded === group.id && (
                <div className="border-t border-gray-800 p-4 space-y-6">
                  <AgentPatternsPanel
                    groupId={group.id}
                    patterns={group.agents}
                    onRefresh={fetchGroups}
                  />
                  <IntegrationsPanel
                    groupId={group.id}
                    assigned={group.integrations}
                    onRefresh={fetchGroups}
                  />
                  <UsersPanel groupId={group.id} assigned={group.users} onRefresh={fetchGroups} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentPatternsPanel({
  groupId,
  patterns,
  onRefresh,
}: {
  groupId: string;
  patterns: Array<{ agentPattern: string }>;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [newPattern, setNewPattern] = useState('');

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!newPattern.trim()) return;
    try {
      await apiFetch(`/access-groups/${groupId}/agents`, {
        method: 'POST',
        body: JSON.stringify({ pattern: newPattern.trim() }),
      });
      setNewPattern('');
      toast('Pattern added', 'success');
      onRefresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to add pattern', 'error');
    }
  };

  const handleRemove = async (pattern: string) => {
    try {
      await apiFetch(`/access-groups/${groupId}/agents`, {
        method: 'DELETE',
        body: JSON.stringify({ pattern }),
      });
      toast('Pattern removed', 'success');
      onRefresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to remove pattern', 'error');
    }
  };

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Agent Patterns
      </h3>
      <p className="mt-0.5 text-xs text-gray-600">
        Glob patterns matching agent names (e.g. prod-*, citrix-*)
      </p>
      <form onSubmit={handleAdd} className="mt-2 flex gap-2">
        <input
          type="text"
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          placeholder="e.g. prod-*"
          className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
        >
          Add
        </button>
      </form>
      {patterns.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {patterns.map((p) => (
            <span
              key={p.agentPattern}
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-800 px-2.5 py-1 text-xs text-gray-300"
            >
              <code>{p.agentPattern}</code>
              <button
                type="button"
                onClick={() => handleRemove(p.agentPattern)}
                className="text-gray-500 hover:text-red-400"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function IntegrationsPanel({
  groupId,
  assigned,
  onRefresh,
}: {
  groupId: string;
  assigned: Array<{ integrationId: string }>;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [allIntegrations, setAllIntegrations] = useState<Integration[]>([]);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    apiFetch<{ integrations: Integration[] }>('/integrations')
      .then((data) => setAllIntegrations(data.integrations))
      .catch(() => {});
  }, []);

  const assignedIds = new Set(assigned.map((a) => a.integrationId));
  const available = allIntegrations.filter((i) => !assignedIds.has(i.id));

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    try {
      await apiFetch(`/access-groups/${groupId}/integrations`, {
        method: 'POST',
        body: JSON.stringify({ integrationId: selectedId }),
      });
      setSelectedId('');
      toast('Integration assigned', 'success');
      onRefresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to assign integration', 'error');
    }
  };

  const handleRemove = async (integrationId: string) => {
    try {
      await apiFetch(`/access-groups/${groupId}/integrations`, {
        method: 'DELETE',
        body: JSON.stringify({ integrationId }),
      });
      toast('Integration removed', 'success');
      onRefresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to remove integration', 'error');
    }
  };

  const getIntegrationName = (id: string) => allIntegrations.find((i) => i.id === id)?.name ?? id;

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Integrations</h3>
      {available.length > 0 && (
        <form onSubmit={handleAdd} className="mt-2 flex gap-2">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="">Select integration...</option>
            {available.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.type})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
          >
            Add
          </button>
        </form>
      )}
      {assigned.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {assigned.map((a) => (
            <span
              key={a.integrationId}
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-800 px-2.5 py-1 text-xs text-gray-300"
            >
              {getIntegrationName(a.integrationId)}
              <button
                type="button"
                onClick={() => handleRemove(a.integrationId)}
                className="text-gray-500 hover:text-red-400"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      {assigned.length === 0 && available.length === 0 && (
        <p className="mt-1 text-xs text-gray-600">No integrations available.</p>
      )}
    </div>
  );
}

function UsersPanel({
  groupId,
  assigned,
  onRefresh,
}: {
  groupId: string;
  assigned: Array<{ userId: string }>;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [allUsers, setAllUsers] = useState<AuthorizedUser[]>([]);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    apiFetch<{ users: AuthorizedUser[] }>('/authorized-users')
      .then((data) => setAllUsers(data.users))
      .catch(() => {});
  }, []);

  const assignedIds = new Set(assigned.map((a) => a.userId));
  const available = allUsers.filter((u) => !assignedIds.has(u.id));

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    try {
      await apiFetch(`/access-groups/${groupId}/users`, {
        method: 'POST',
        body: JSON.stringify({ userId: selectedId }),
      });
      setSelectedId('');
      toast('User assigned', 'success');
      onRefresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to assign user', 'error');
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await apiFetch(`/access-groups/${groupId}/users`, {
        method: 'DELETE',
        body: JSON.stringify({ userId }),
      });
      toast('User removed', 'success');
      onRefresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to remove user', 'error');
    }
  };

  const getUserLabel = (id: string) => {
    const user = allUsers.find((u) => u.id === id);
    return user ? user.email : id;
  };

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Users</h3>
      {available.length > 0 && (
        <form onSubmit={handleAdd} className="mt-2 flex gap-2">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="">Select user...</option>
            {available.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
                {u.displayName ? ` (${u.displayName})` : ''}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
          >
            Add
          </button>
        </form>
      )}
      {assigned.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {assigned.map((a) => (
            <span
              key={a.userId}
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-800 px-2.5 py-1 text-xs text-gray-300"
            >
              {getUserLabel(a.userId)}
              <button
                type="button"
                onClick={() => handleRemove(a.userId)}
                className="text-gray-500 hover:text-red-400"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      {assigned.length === 0 && available.length === 0 && (
        <p className="mt-1 text-xs text-gray-600">No authorized users available.</p>
      )}
    </div>
  );
}
