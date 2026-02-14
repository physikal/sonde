import { useCallback, useEffect, useState } from 'react';

interface HealthData {
  status: string;
  timestamp: string;
  agents: number;
}

export function Overview() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(() => {
    fetch('/health')
      .then((r) => r.json() as Promise<HealthData>)
      .then((data) => {
        setHealth(data);
        setError(null);
      })
      .catch(() => {
        setHealth(null);
        setError('Unable to reach hub');
      });
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10_000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  if (error && !health) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-white">Overview</h1>
        <p className="mt-4 text-red-400">{error}</p>
        <button
          type="button"
          onClick={fetchHealth}
          className="mt-2 rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white">Overview</h1>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Hub status card */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Hub Status</p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                health?.status === 'ok' ? 'bg-emerald-400' : 'bg-red-400'
              }`}
            />
            <span className="text-lg font-semibold text-white">
              {health?.status === 'ok' ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>

        {/* Connected agents card */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Connected Agents
          </p>
          <p className="mt-2 text-3xl font-bold text-white">{health?.agents ?? '\u2014'}</p>
        </div>

        {/* Placeholder card */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Fleet</p>
          <p className="mt-2 text-sm text-gray-500">Fleet details coming soon.</p>
        </div>
      </div>
    </div>
  );
}
