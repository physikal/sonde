import { useCallback, useEffect, useState } from 'react';

interface HealthData {
  status: string;
  agents: number;
}

export function TopBar() {
  const [health, setHealth] = useState<HealthData | null>(null);

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

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-800 bg-gray-900 px-6">
      <span className="text-sm font-medium text-gray-300">Dashboard</span>
      <div className="flex items-center gap-3">
        <span
          className={`inline-block h-2 w-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-red-400'}`}
        />
        <span className="text-xs text-gray-400">
          Hub {isOnline ? 'online' : 'offline'}
          {health && ` \u00B7 ${health.agents} agent${health.agents !== 1 ? 's' : ''}`}
        </span>
      </div>
    </header>
  );
}
