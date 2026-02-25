import { useEffect, useState } from 'react';

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Your account is not authorized. Contact an administrator.',
  state_mismatch: 'Authentication failed (state mismatch). Please try again.',
  token_exchange_failed: 'Authentication failed. Please try again.',
  config_error: 'SSO configuration error. Contact an administrator.',
  no_email: 'Could not retrieve email from identity provider.',
  invalid_token: 'Invalid authentication token. Please try again.',
  no_code: 'Authentication failed (no authorization code). Please try again.',
};

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  useEffect(() => {
    // Check SSO status
    fetch('/api/v1/sso/status')
      .then((res) => res.json())
      .then((data: { enabled?: boolean }) => {
        setSsoEnabled(data.enabled === true);
      })
      .catch(() => {});

    // Check for error from SSO redirect
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('error');
    if (errorParam) {
      setError(ERROR_MESSAGES[errorParam] ?? `Authentication error: ${errorParam}`);
      // Clean up the URL
      window.history.replaceState({}, '', '/login');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/auth/local/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? 'Login failed');
        return;
      }

      // Full reload so AuthProvider re-fetches /auth/status with the new cookie
      const params = new URLSearchParams(window.location.search);
      const returnTo = params.get('returnTo');
      // Only allow relative paths to prevent open redirect
      const redirectTo = returnTo?.startsWith('/') ? returnTo : '/';
      window.location.href = redirectTo;
    } catch {
      setError('Network error. Is the hub running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <img src="/sonde-logo.svg" alt="Sonde" className="h-36" />
          <p className="mt-3 text-sm text-gray-400">Sign in to your dashboard</p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-900/30 border border-red-800 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {ssoEnabled && (
          <>
            <a
              href="/auth/entra/login"
              className="flex w-full items-center justify-center gap-2 rounded-md bg-gray-800 border border-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-950"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 21 21"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                role="img"
                aria-label="Microsoft logo"
              >
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Sign in with Microsoft
            </a>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-700" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-gray-950 px-2 text-gray-500">or</span>
              </div>
            </div>
          </>
        )}

        {!ssoEnabled && <div className="mb-6" />}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-xs font-medium text-gray-400 uppercase">
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-medium text-gray-400 uppercase">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-950 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
