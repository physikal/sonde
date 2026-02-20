import { type FormEvent, useEffect, useState } from 'react';
import { useToast } from '../components/common/Toast';
import { apiFetch } from '../lib/api';

interface AiConfig {
  configured: boolean;
  model: string;
}

interface TestResult {
  success: boolean;
  error?: string;
}

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
];

export function AiSettings() {
  return (
    <div className="space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-white">AI Analysis</h1>
      <AiConfigSection />
    </div>
  );
}

function AiConfigSection() {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-20250514');
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    apiFetch<AiConfig>('/settings/ai')
      .then((data) => {
        setConfigured(data.configured);
        setModel(data.model);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();

    const body: Record<string, string> = {};
    if (apiKey.trim()) body.apiKey = apiKey;
    if (model) body.model = model;

    if (Object.keys(body).length === 0) {
      toast('Nothing to save', 'info');
      return;
    }

    setSaving(true);
    try {
      const result = await apiFetch<AiConfig>('/settings/ai', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setConfigured(result.configured);
      setModel(result.model);
      setApiKey('');
      setTestResult(null);
      toast('AI settings saved', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<TestResult>('/settings/ai/test', {
        method: 'POST',
      });
      setTestResult(result);
      toast(
        result.success ? 'Connection successful' : `Test failed: ${result.error}`,
        result.success ? 'success' : 'error',
      );
    } catch {
      toast('Failed to test connection', 'error');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-lg font-medium text-white">Claude API</h2>
        <p className="mt-2 text-sm text-gray-400">Loading...</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-medium text-white">Claude API</h2>
        {configured ? (
          <span className="flex items-center gap-1.5 text-xs">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-emerald-400">Configured</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs">
            <span className="inline-block h-2 w-2 rounded-full bg-gray-600" />
            <span className="text-gray-500">Not configured</span>
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-400">
        Connect to Claude for automated trending analysis. The API key is encrypted at rest.
      </p>

      <form onSubmit={handleSave} className="mt-6 space-y-4 max-w-lg">
        <div>
          <label htmlFor="aiApiKey" className="block text-xs font-medium text-gray-400 uppercase">
            API Key
          </label>
          <input
            id="aiApiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={configured ? '••••••••' : 'sk-ant-...'}
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            {configured
              ? 'Leave blank to keep the existing key.'
              : 'Get an API key from console.anthropic.com'}
          </p>
        </div>

        <div>
          <label htmlFor="aiModel" className="block text-xs font-medium text-gray-400 uppercase">
            Model
          </label>
          <select
            id="aiModel"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !configured}
            className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {testResult && (
          <div
            className={`rounded-md border p-3 text-sm ${
              testResult.success
                ? 'border-emerald-800 bg-emerald-950/30 text-emerald-300'
                : 'border-red-800 bg-red-950/30 text-red-300'
            }`}
          >
            {testResult.success
              ? 'API key is valid. Claude is reachable.'
              : `Connection failed: ${testResult.error}`}
          </div>
        )}
      </form>
    </section>
  );
}
