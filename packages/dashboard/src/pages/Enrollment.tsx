import { useCallback, useEffect, useState } from 'react';
import { ApiKeyGate } from '../components/common/ApiKeyGate';
import { authFetch } from '../hooks/useApiKey';
import { useWebSocket } from '../hooks/useWebSocket';

interface EnrollmentToken {
  token: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedByAgent: string | null;
  status: 'active' | 'used' | 'expired';
}

const STATUS_COLORS: Record<string, string> = {
  active: 'text-emerald-400',
  used: 'text-blue-400',
  expired: 'text-gray-500',
};

export function Enrollment() {
  return <ApiKeyGate>{(apiKey) => <EnrollmentInner apiKey={apiKey} />}</ApiKeyGate>;
}

function EnrollmentInner({ apiKey }: { apiKey: string }) {
  const [tokens, setTokens] = useState<EnrollmentToken[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { agentStatus } = useWebSocket();

  const fetchTokens = useCallback(() => {
    authFetch<{ tokens: EnrollmentToken[] }>('/enrollment-tokens', apiKey).then((data) =>
      setTokens(data.tokens),
    );
  }, [apiKey]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleCreate = () => {
    setCreating(true);
    authFetch<{ token: string; expiresAt: string }>('/enrollment-tokens', apiKey, {
      method: 'POST',
    })
      .then((data) => {
        setNewToken(data.token);
        fetchTokens();
      })
      .finally(() => setCreating(false));
  };

  const hubUrl = window.location.origin;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Enrollment</h1>
          <p className="mt-1 text-sm text-gray-400">
            Generate tokens to enroll new agents.{' '}
            <span className="text-emerald-400">
              {agentStatus.onlineAgentIds.length} agent
              {agentStatus.onlineAgentIds.length !== 1 ? 's' : ''} online
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Generate Token'}
        </button>
      </div>

      {/* New token display */}
      {newToken && (
        <div className="mt-6 rounded-xl border border-blue-800 bg-blue-950/30 p-5">
          <p className="text-sm font-medium text-blue-300">New enrollment token created</p>
          <div className="mt-2 space-y-2">
            <div>
              <p className="text-xs text-gray-500 uppercase">One-liner install command</p>
              <code className="mt-1 block rounded-lg bg-gray-800 px-4 py-2.5 text-sm text-gray-200 font-mono break-all">
                sonde enroll --hub {hubUrl} --token {newToken} &amp;&amp; sonde start
              </code>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Token (expires in 15 minutes)</p>
              <code className="mt-1 block rounded-lg bg-gray-800 px-4 py-2.5 text-sm text-gray-200 font-mono break-all">
                {newToken}
              </code>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNewToken(null)}
            className="mt-3 text-xs text-gray-500 hover:text-gray-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Live agent feed */}
      {agentStatus.onlineAgents.length > 0 && (
        <div className="mt-6 rounded-xl border border-gray-800 bg-gray-900 p-5">
          <p className="text-xs font-medium text-gray-500 uppercase mb-3">Live Agents</p>
          <div className="flex flex-wrap gap-2">
            {agentStatus.onlineAgents.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1.5 rounded-md bg-gray-800 px-3 py-1.5 text-sm"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-gray-200">{a.name}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Token history */}
      <div className="mt-6 overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Token</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3">Used By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {tokens.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  No enrollment tokens created yet.
                </td>
              </tr>
            ) : (
              tokens.map((t) => (
                <tr key={t.token} className="bg-gray-950">
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">
                    {t.token.slice(0, 8)}...{t.token.slice(-4)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={STATUS_COLORS[t.status] ?? 'text-gray-400'}>{t.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {new Date(t.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {new Date(t.expiresAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{t.usedByAgent ?? '\u2014'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
