import { type FormEvent, useEffect, useState } from 'react';
import { useToast } from '../components/common/Toast';
import { apiFetch } from '../lib/api';

interface SsoConfig {
  tenantId: string;
  clientId: string;
  enabled: boolean;
}

interface SsoStatus {
  configured: boolean;
  enabled: boolean;
}

export function Settings() {
  return (
    <div className="space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-white">SSO Configuration</h1>
      <SsoConfigSection />
    </div>
  );
}

function SsoConfigSection() {
  const { toast } = useToast();
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [hasExisting, setHasExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SsoStatus | null>(null);

  const hubUrl = window.location.origin;
  const redirectUri = `${hubUrl}/auth/entra/callback`;

  useEffect(() => {
    apiFetch<SsoConfig>('/sso/entra')
      .then((data) => {
        setTenantId(data.tenantId);
        setClientId(data.clientId);
        setEnabled(data.enabled);
        setHasExisting(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!tenantId.trim() || !clientId.trim()) {
      toast('Tenant ID and Client ID are required', 'error');
      return;
    }
    if (!hasExisting && !clientSecret.trim()) {
      toast('Client Secret is required for initial configuration', 'error');
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = { tenantId, clientId, enabled };
      if (clientSecret.trim()) {
        body.clientSecret = clientSecret;
      }

      const method = hasExisting ? 'PUT' : 'POST';
      await apiFetch('/sso/entra', {
        method,
        body: JSON.stringify(body),
      });

      setHasExisting(true);
      setClientSecret('');
      toast('SSO configuration saved', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save SSO config';
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<SsoStatus>('/sso/status');
      setTestResult(result);
      toast(
        result.configured
          ? result.enabled
            ? 'SSO is configured and enabled'
            : 'SSO is configured but disabled'
          : 'SSO is not configured',
        result.configured && result.enabled ? 'success' : 'info',
      );
    } catch {
      toast('Failed to check SSO status', 'error');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-lg font-medium text-white">Microsoft Entra ID</h2>
        <p className="mt-2 text-sm text-gray-400">Loading...</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-medium text-white">Microsoft Entra ID</h2>
        {hasExisting ? (
          <span className="flex items-center gap-1.5 text-xs">
            <span
              className={`inline-block h-2 w-2 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-gray-500'}`}
            />
            <span className={enabled ? 'text-emerald-400' : 'text-gray-500'}>
              {enabled ? 'Configured' : 'Disabled'}
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs">
            <span className="inline-block h-2 w-2 rounded-full bg-gray-600" />
            <span className="text-gray-500">Not configured</span>
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-400">
        Configure Microsoft Entra ID (Azure AD) single sign-on for the dashboard.
      </p>

      <form onSubmit={handleSave} className="mt-6 space-y-4 max-w-lg">
        <div>
          <label htmlFor="tenantId" className="block text-xs font-medium text-gray-400 uppercase">
            Tenant ID
          </label>
          <input
            id="tenantId"
            type="text"
            required
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            Azure Portal &rarr; Entra ID &rarr; Overview &rarr; Tenant ID
          </p>
        </div>

        <div>
          <label htmlFor="clientId" className="block text-xs font-medium text-gray-400 uppercase">
            Client ID (Application ID)
          </label>
          <input
            id="clientId"
            type="text"
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            Azure Portal &rarr; App registrations &rarr; Your app &rarr; Application (client) ID
          </p>
        </div>

        <div>
          <label
            htmlFor="clientSecret"
            className="block text-xs font-medium text-gray-400 uppercase"
          >
            Client Secret
          </label>
          <input
            id="clientSecret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={hasExisting ? '••••••••' : 'Enter client secret'}
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            {hasExisting
              ? 'Leave blank to keep the existing secret.'
              : 'Azure Portal → App registrations → Certificates & secrets → New client secret'}
          </p>
        </div>

        <div>
          <span className="block text-xs font-medium text-gray-400 uppercase">Redirect URI</span>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 rounded-md border border-gray-700 bg-gray-800/50 px-3 py-2 text-sm text-gray-300 font-mono">
              {redirectUri}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(redirectUri);
                toast('Copied to clipboard', 'success');
              }}
              className="rounded-md bg-gray-800 px-3 py-2 text-xs text-gray-400 hover:text-gray-200"
            >
              Copy
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Add this URI to your app registration under Authentication &rarr; Platform
            configurations &rarr; Web &rarr; Redirect URIs
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled(!enabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${enabled ? 'bg-blue-600' : 'bg-gray-700'}`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
          <span className="text-sm text-gray-300">SSO Enabled</span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {testResult && (
          <div
            className={`rounded-md border p-3 text-sm ${
              testResult.configured && testResult.enabled
                ? 'border-emerald-800 bg-emerald-950/30 text-emerald-300'
                : 'border-gray-700 bg-gray-800 text-gray-400'
            }`}
          >
            {testResult.configured
              ? testResult.enabled
                ? 'SSO is configured and enabled. Users can sign in with Microsoft.'
                : 'SSO is configured but currently disabled.'
              : 'SSO is not yet configured.'}
          </div>
        )}
      </form>
    </section>
  );
}
