import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useToast } from '../components/common/Toast';
import { apiFetch } from '../lib/api';

interface SsoConfig {
  tenantId: string;
  clientId: string;
  enabled: boolean;
}

interface AuthorizedUser {
  id: string;
  email: string;
  roleId: string;
  createdAt: string;
}

export function Settings() {
  return (
    <div className="space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-white">Settings</h1>
      <SsoConfigSection />
      <AuthorizedUsersSection />
    </div>
  );
}

function SsoConfigSection() {
  const { toast } = useToast();
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [hasExisting, setHasExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/sso/entra', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<SsoConfig>;
      })
      .then((data) => {
        if (data) {
          setTenantId(data.tenantId);
          setClientId(data.clientId);
          setEnabled(data.enabled);
          setHasExisting(true);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!tenantId.trim() || !clientId.trim()) {
      toast('Tenant ID and Client ID are required', 'error');
      return;
    }
    if (!hasExisting && !clientSecret.trim()) {
      toast('Client Secret is required for initial configuration', 'error');
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = { tenantId, clientId, enabled };
      if (clientSecret.trim()) {
        body.clientSecret = clientSecret;
      }

      const method = hasExisting ? 'PUT' : 'POST';
      await apiFetch('/sso/entra', {
        method,
        body: JSON.stringify(body),
      });

      setHasExisting(true);
      setClientSecret('');
      toast('SSO configuration saved', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save SSO config';
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-lg font-medium text-white">SSO Configuration</h2>
        <p className="mt-2 text-sm text-gray-400">Loading...</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <h2 className="text-lg font-medium text-white">SSO Configuration</h2>
      <p className="mt-1 text-sm text-gray-400">
        Configure Microsoft Entra ID (Azure AD) single sign-on for the dashboard.
      </p>

      <form onSubmit={handleSave} className="mt-6 space-y-4 max-w-lg">
        <div>
          <label htmlFor="tenantId" className="block text-xs font-medium text-gray-400 uppercase">
            Tenant ID
          </label>
          <input
            id="tenantId"
            type="text"
            required
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="clientId" className="block text-xs font-medium text-gray-400 uppercase">
            Client ID
          </label>
          <input
            id="clientId"
            type="text"
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="clientSecret"
            className="block text-xs font-medium text-gray-400 uppercase"
          >
            Client Secret
          </label>
          <input
            id="clientSecret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={hasExisting ? '••••••••' : 'Enter client secret'}
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {hasExisting && (
            <p className="mt-1 text-xs text-gray-500">Leave blank to keep the existing secret.</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled(!enabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${enabled ? 'bg-blue-600' : 'bg-gray-700'}`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
          <span className="text-sm text-gray-300">SSO Enabled</span>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save SSO Configuration'}
        </button>
      </form>
    </section>
  );
}

function AuthorizedUsersSection() {
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
      toast('Authorized user added', 'success');
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add user';
      toast(msg, 'error');
    } finally {
      setAdding(false);
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
      <h2 className="text-lg font-medium text-white">Authorized SSO Users</h2>
      <p className="mt-1 text-sm text-gray-400">
        Users in this list can sign in via SSO. Users not listed will be denied access.
      </p>

      <form onSubmit={handleAdd} className="mt-6 flex items-end gap-3 max-w-lg">
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
            <option value="owner">Owner</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={adding}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {adding ? 'Adding...' : 'Add'}
        </button>
      </form>

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-500">No authorized users configured.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs font-medium text-gray-400 uppercase">
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Role</th>
                <th className="pb-2 pr-4">Added</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="py-3 pr-4 text-white">{user.email}</td>
                  <td className="py-3 pr-4">
                    <span className="inline-block rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-300">
                      {user.roleId}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-gray-400">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 text-right">
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
