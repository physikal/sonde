import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useToast } from '../components/common/Toast';
import { apiFetch } from '../lib/api';

interface AuthorizedUser {
  id: string;
  email: string;
  roleId: string;
  displayName: string;
  enabled: boolean;
  createdBy: string;
  lastLoginAt: string | null;
  loginCount: number;
  createdAt: string;
}

interface AuthorizedGroup {
  id: string;
  entraGroupId: string;
  entraGroupName: string;
  roleId: string;
  createdAt: string;
  createdBy: string;
}

export function Users() {
  return (
    <div className="space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-white">Users &amp; Groups</h1>

      <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-5">
        <h2 className="text-sm font-medium text-gray-300 uppercase tracking-wide">Roles</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-gray-800 bg-gray-900 px-4 py-3">
            <dt className="flex items-center gap-2">
              <span className="inline-block rounded-full border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs font-medium leading-none text-gray-300">
                member
              </span>
            </dt>
            <dd className="mt-1.5 text-sm text-gray-400">
              MCP access only. Connects via Claude Desktop or Claude Code with an API key.
              Full diagnostic capability across all agents and integrations.
              Cannot access the Hub dashboard.
            </dd>
          </div>
          <div className="rounded-md border border-gray-800 bg-gray-900 px-4 py-3">
            <dt className="flex items-center gap-2">
              <span className="inline-block rounded-full border border-blue-700 bg-blue-900/50 px-2.5 py-1 text-xs font-medium leading-none text-blue-300">
                admin
              </span>
            </dt>
            <dd className="mt-1.5 text-sm text-gray-400">
              Everything in Member, plus Hub dashboard access.
              Can enroll agents, manage integrations, manage users and groups, and create API keys.
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-gray-500">
          The <span className="text-amber-400/80">owner</span> role is reserved for the bootstrap
          admin configured via environment variables and cannot be assigned here.
        </p>
      </div>

      <IndividualUsersSection />
      <AuthorizedGroupsSection />
    </div>
  );
}

function IndividualUsersSection() {
  const { toast } = useToast();
  const [users, setUsers] = useState<AuthorizedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('member');
  const [adding, setAdding] = useState(false);

  const fetchUsers = useCallback(() => {
    setLoading(true);
    apiFetch<{ users: AuthorizedUser[] }>('/authorized-users')
      .then((data) => setUsers(data.users))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;

    setAdding(true);
    try {
      await apiFetch('/authorized-users', {
        method: 'POST',
        body: JSON.stringify({ email: newEmail.trim(), role: newRole }),
      });
      setNewEmail('');
      setNewRole('member');
      toast('User added', 'success');
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add user';
      toast(msg, 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleRoleChange = async (id: string, role: string) => {
    try {
      await apiFetch(`/authorized-users/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
      toast('Role updated', 'success');
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update role';
      toast(msg, 'error');
    }
  };

  const handleToggleEnabled = async (id: string, currentEnabled: boolean) => {
    try {
      await apiFetch(`/authorized-users/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      toast(currentEnabled ? 'User disabled' : 'User enabled', 'success');
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update user';
      toast(msg, 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/authorized-users/${id}`, { method: 'DELETE' });
      toast('User removed', 'success');
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove user';
      toast(msg, 'error');
    }
  };

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <h2 className="text-lg font-medium text-white">Authorized Users</h2>
      <p className="mt-1 text-sm text-gray-400">
        Individual users authorized to access Sonde. Users can be added manually or auto-created
        from Entra group membership on first SSO login.
      </p>

      <form onSubmit={handleAdd} className="mt-6 flex items-end gap-3 max-w-2xl">
        <div className="flex-1">
          <label htmlFor="newEmail" className="block text-xs font-medium text-gray-400 uppercase">
            Email
          </label>
          <input
            id="newEmail"
            type="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="user@example.com"
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="newRole" className="block text-xs font-medium text-gray-400 uppercase">
            Role
          </label>
          <select
            id="newRole"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            className="mt-1 block rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={adding}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {adding ? 'Adding...' : 'Add User'}
        </button>
      </form>

      <div className="mt-6 overflow-x-auto">
        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-500">No authorized users configured.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs font-medium text-gray-500 uppercase">
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Role</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Source</th>
                <th className="pb-2 pr-4">Last Login</th>
                <th className="pb-2 pr-4">Logins</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="py-3 pr-4 text-white">{user.email}</td>
                  <td className="py-3 pr-4 text-gray-400">{user.displayName || '-'}</td>
                  <td className="py-3 pr-4">
                    <select
                      value={user.roleId}
                      onChange={(e) => handleRoleChange(user.id, e.target.value)}
                      className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="py-3 pr-4">
                    {user.enabled ? (
                      <span className="inline-block rounded-full bg-emerald-900/50 px-2.5 py-1 text-xs font-medium leading-none text-emerald-400">
                        enabled
                      </span>
                    ) : (
                      <span className="inline-block rounded-full bg-red-900/50 px-2.5 py-1 text-xs font-medium leading-none text-red-400">
                        disabled
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="inline-block rounded-full bg-gray-800 px-2.5 py-1 text-xs font-medium leading-none text-gray-400">
                      {user.createdBy}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-gray-400 text-xs">
                    {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="py-3 pr-4 text-gray-400 text-xs">{user.loginCount}</td>
                  <td className="py-3 text-right space-x-2">
                    <button
                      type="button"
                      onClick={() => handleToggleEnabled(user.id, user.enabled)}
                      className="text-xs text-gray-400 hover:text-gray-200"
                    >
                      {user.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(user.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function AuthorizedGroupsSection() {
  const { toast } = useToast();
  const [groups, setGroups] = useState<AuthorizedGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [newGroupId, setNewGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newRole, setNewRole] = useState('member');
  const [adding, setAdding] = useState(false);

  const fetchGroups = useCallback(() => {
    setLoading(true);
    apiFetch<{ groups: AuthorizedGroup[] }>('/authorized-groups')
      .then((data) => setGroups(data.groups))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!newGroupId.trim()) return;

    setAdding(true);
    try {
      await apiFetch('/authorized-groups', {
        method: 'POST',
        body: JSON.stringify({
          entraGroupId: newGroupId.trim(),
          entraGroupName: newGroupName.trim(),
          role: newRole,
        }),
      });
      setNewGroupId('');
      setNewGroupName('');
      setNewRole('member');
      toast('Group added', 'success');
      fetchGroups();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add group';
      toast(msg, 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleRoleChange = async (id: string, role: string) => {
    try {
      await apiFetch(`/authorized-groups/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
      toast('Group role updated', 'success');
      fetchGroups();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update group';
      toast(msg, 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/authorized-groups/${id}`, { method: 'DELETE' });
      toast('Group removed', 'success');
      fetchGroups();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove group';
      toast(msg, 'error');
    }
  };

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <h2 className="text-lg font-medium text-white">Authorized Groups</h2>
      <p className="mt-1 text-sm text-gray-400">
        Map Entra security groups to Sonde roles. Members of these groups are automatically
        authorized on SSO login with the group's default role.
      </p>

      <form onSubmit={handleAdd} className="mt-6 flex items-end gap-3 max-w-3xl">
        <div className="flex-1">
          <label htmlFor="newGroupId" className="block text-xs font-medium text-gray-400 uppercase">
            Entra Group ID
          </label>
          <input
            id="newGroupId"
            type="text"
            required
            value={newGroupId}
            onChange={(e) => setNewGroupId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex-1">
          <label
            htmlFor="newGroupName"
            className="block text-xs font-medium text-gray-400 uppercase"
          >
            Display Name
          </label>
          <input
            id="newGroupName"
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="e.g. SG-Sonde-Users"
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label
            htmlFor="newGroupRole"
            className="block text-xs font-medium text-gray-400 uppercase"
          >
            Role
          </label>
          <select
            id="newGroupRole"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            className="mt-1 block rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={adding}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {adding ? 'Adding...' : 'Add Group'}
        </button>
      </form>

      <div className="mt-6 overflow-x-auto">
        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-gray-500">No authorized groups configured.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs font-medium text-gray-500 uppercase">
                <th className="pb-2 pr-4">Group Name</th>
                <th className="pb-2 pr-4">Entra Group ID</th>
                <th className="pb-2 pr-4">Default Role</th>
                <th className="pb-2 pr-4">Added</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {groups.map((group) => (
                <tr key={group.id}>
                  <td className="py-3 pr-4 text-white">
                    {group.entraGroupName || group.entraGroupId}
                  </td>
                  <td className="py-3 pr-4 text-gray-400 text-xs font-mono">
                    {group.entraGroupId}
                  </td>
                  <td className="py-3 pr-4">
                    <select
                      value={group.roleId}
                      onChange={(e) => handleRoleChange(group.id, e.target.value)}
                      className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="py-3 pr-4 text-gray-400 text-xs">
                    {new Date(group.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(group.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
