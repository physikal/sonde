import { useState } from 'react';
import { apiFetch } from '../../../lib/api';

interface CompleteStepProps {
  onComplete: () => void;
}

export function CompleteStep({ onComplete }: CompleteStepProps) {
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleComplete = () => {
    setCompleting(true);
    setError(null);
    apiFetch('/setup/complete', { method: 'POST' })
      .then(() => onComplete())
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to complete setup');
        setCompleting(false);
      });
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-white">Setup Complete</h2>
      <p className="mt-3 text-gray-400 leading-relaxed">
        Your Sonde hub is configured and ready to use. You can always adjust settings later from the
        dashboard.
      </p>

      <ul className="mt-4 space-y-2 text-sm text-gray-400">
        <li className="flex items-center gap-2">
          <span className="text-emerald-400">&#10003;</span> API key configured
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
