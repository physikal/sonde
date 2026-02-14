import { useCallback, useEffect, useState } from 'react';

export function AgentEnrollStep() {
  const [agentCount, setAgentCount] = useState<number | null>(null);

  const pollHealth = useCallback(() => {
    fetch('/health')
      .then((r) => r.json() as Promise<{ agents: number }>)
      .then((d) => setAgentCount(d.agents))
      .catch(() => {});
  }, []);

  useEffect(() => {
    pollHealth();
    const interval = setInterval(pollHealth, 5000);
    return () => clearInterval(interval);
  }, [pollHealth]);

  return (
    <div>
      <h2 className="text-xl font-semibold text-white">Enroll an Agent</h2>
      <p className="mt-3 text-gray-400 leading-relaxed">
        Install the Sonde agent on a target machine and connect it to this hub.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
            1. Enroll the agent
          </p>
          <code className="block rounded-lg bg-gray-800 px-4 py-2.5 text-sm text-gray-200 font-mono">
            sonde enroll --hub {window.location.origin} --token &lt;enrollment-token&gt;
          </code>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
            2. Start the agent
          </p>
          <code className="block rounded-lg bg-gray-800 px-4 py-2.5 text-sm text-gray-200 font-mono">
            sonde start
          </code>
        </div>
      </div>

      <div className="mt-5 rounded-lg bg-gray-800/50 border border-gray-700 p-4">
        <p className="text-sm text-gray-300">
          Connected agents:{' '}
          <span className="font-semibold text-white">
            {agentCount !== null ? agentCount : '\u2014'}
          </span>
        </p>
        {agentCount !== null && agentCount > 0 && (
          <p className="mt-1 text-xs text-emerald-400">Agent connected! You can proceed.</p>
        )}
      </div>
    </div>
  );
}
