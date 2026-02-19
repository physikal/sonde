import { useState } from 'react';
import { apiFetch } from '../../../lib/api';

interface CompleteStepProps {
  onComplete: () => void;
}

export function CompleteStep({ onComplete }: CompleteStepProps) {
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  const handleComplete = () => {
    setCompleting(true);
    setError(null);
    apiFetch<{ ok: boolean; apiKey?: string }>('/setup/complete', { method: 'POST' })
      .then((data) => {
        if (data.apiKey) {
          setGeneratedKey(data.apiKey);
        } else {
          onComplete();
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to complete setup');
        setCompleting(false);
      });
  };

  if (generatedKey) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-white">Your API Key</h2>
        <p className="mt-3 text-gray-400 leading-relaxed">
          A default admin API key has been generated. Save it now — you won't be able to see it
          again.
        </p>

        <div className="mt-4 rounded-xl border border-amber-800 bg-amber-950/30 p-5">
          <p className="text-sm font-medium text-amber-300">Default Admin API Key</p>
          <code className="mt-2 block rounded-lg bg-gray-800 px-4 py-2.5 text-sm text-gray-200 font-mono break-all">
            {generatedKey}
          </code>
          <p className="mt-2 text-xs text-amber-400/70">
            Use this key to authenticate MCP clients (Claude Desktop, etc.) and API requests. You
            can create additional keys from the dashboard.
          </p>
        </div>

        <button
          type="button"
          onClick={onComplete}
          className="mt-6 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-white">Setup Complete</h2>
      <p className="mt-3 text-gray-400 leading-relaxed">
        Your Sonde hub is configured and ready to use. You can always adjust settings later from the
        dashboard.
      </p>

      <ul className="mt-4 space-y-2 text-sm text-gray-400">
        <li className="flex items-center gap-2">
          <span className="text-emerald-400">&#10003;</span> Encryption secret configured
        </li>
        <li className="flex items-center gap-2">
          <span className="text-emerald-400">&#10003;</span> MCP endpoint available
        </li>
        <li className="flex items-center gap-2">
          <span className="text-emerald-400">&#10003;</span> Agent enrollment ready
        </li>
      </ul>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <button
        type="button"
        onClick={handleComplete}
        disabled={completing}
        className="mt-6 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {completing ? 'Finishing...' : 'Go to Dashboard'}
      </button>
    </div>
  );
}
