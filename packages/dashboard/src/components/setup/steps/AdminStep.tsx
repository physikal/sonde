import { useState } from 'react';

interface AdminStepProps {
  onCreated: () => void;
}

export function AdminStep({ onCreated }: AdminStepProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const passwordMismatch = confirm.length > 0 && password !== confirm;
  const canSubmit =
    username.length >= 3 &&
    password.length >= 8 &&
    password === confirm &&
    !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/v1/setup/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? 'Failed to create admin account');
        return;
      }

      onCreated();
    } catch {
      setError('Network error. Is the hub running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-white">
        Create Admin Account
      </h2>
      <p className="mt-3 text-gray-400 leading-relaxed">
        Create the admin account you&apos;ll use to sign in to the
        dashboard. This account has full access to manage agents,
        integrations, and users.
      </p>

      {error && (
        <div className="mt-4 rounded-md bg-red-900/30 border border-red-800 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="admin-username"
            className="block text-xs font-medium text-gray-400 uppercase"
          >
            Username
          </label>
          <input
            id="admin-username"
            type="text"
            autoComplete="username"
            required
            minLength={3}
            maxLength={64}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="admin"
          />
        </div>

        <div>
          <label
            htmlFor="admin-password"
            className="block text-xs font-medium text-gray-400 uppercase"
          >
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="admin-confirm"
            className="block text-xs font-medium text-gray-400 uppercase"
          >
            Confirm Password
          </label>
          <input
            id="admin-confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 ${
              passwordMismatch
                ? 'border-red-700 bg-gray-800 focus:border-red-500 focus:ring-red-500'
                : 'border-gray-700 bg-gray-800 focus:border-blue-500 focus:ring-blue-500'
            }`}
          />
          {passwordMismatch && (
            <p className="mt-1 text-xs text-red-400">
              Passwords do not match
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Admin Account'}
        </button>
      </form>
    </div>
  );
}
