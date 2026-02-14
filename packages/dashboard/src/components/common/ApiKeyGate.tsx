import { type FormEvent, type ReactNode, useState } from 'react';
import { useApiKey } from '../../hooks/useApiKey';

interface ApiKeyGateProps {
  children: (apiKey: string) => ReactNode;
}

export function ApiKeyGate({ children }: ApiKeyGateProps) {
  const { apiKey, setApiKey } = useApiKey();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (apiKey) {
    return <>{children(apiKey)}</>;
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) {
      setError('API key is required');
      return;
    }
    // Validate by making a test request
    fetch('/api/v1/api-keys', {
      headers: { Authorization: `Bearer ${input.trim()}` },
    }).then((res) => {
      if (res.ok) {
        setApiKey(input.trim());
        setError(null);
      } else {
        setError('Invalid API key');
      }
    });
  };

  return (
    <div className="flex flex-col items-center justify-center p-12">
      <div className="w-full max-w-sm rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-lg font-semibold text-white">Authentication Required</h2>
        <p className="mt-2 text-sm text-gray-400">
          Enter your SONDE_API_KEY to manage this resource.
        </p>
        <form onSubmit={handleSubmit} className="mt-4">
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="API key"
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            className="mt-3 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Authenticate
          </button>
        </form>
      </div>
    </div>
  );
}
