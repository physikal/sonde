import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

interface HealthData {
  status: string;
  agents: number;
}

interface TopBarProps {
  onMenuToggle: () => void;
}

const ROLE_STYLES: Record<string, string> = {
  owner: 'bg-amber-900/50 text-amber-300 border-amber-700',
  admin: 'bg-blue-900/50 text-blue-300 border-blue-700',
  member: 'bg-gray-800 text-gray-300 border-gray-700',
};

export function TopBar({ onMenuToggle }: TopBarProps) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const fetchHealth = useCallback(() => {
    fetch('/health')
      .then((r) => r.json() as Promise<HealthData>)
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10_000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const isOnline = health?.status === 'ok';

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-800 bg-gray-900 px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuToggle}
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white lg:hidden"
          aria-label="Open menu"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            role="img"
            aria-label="Menu"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="text-sm font-medium text-gray-300">Dashboard</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-red-400'}`}
          />
          <span className="text-xs text-gray-400">
            Hub {isOnline ? 'online' : 'offline'}
            {health && ` \u00B7 ${health.agents} agent${health.agents !== 1 ? 's' : ''}`}
          </span>
        </div>
        {user && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-300">{user.displayName}</span>
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase ${ROLE_STYLES[user.role] ?? ROLE_STYLES.member}`}
            >
              {user.role}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
