import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../components/common/Toast';
import { ActivityLog } from '../components/integration/ActivityLog';
import { apiFetch } from '../lib/api';

interface CredentialFieldDef {
  key: string;
  label: string;
  placeholder?: string;
  sensitive?: boolean;
}

interface IntegrationTypeDef {
  value: string;
  label: string;
  authMethods: Array<'api_key' | 'bearer_token' | 'oauth2'>;
  credentialFields: Record<string, CredentialFieldDef[]>;
}

const INTEGRATION_TYPES: IntegrationTypeDef[] = [
  {
    value: 'servicenow',
    label: 'ServiceNow',
    authMethods: ['api_key', 'oauth2'],
    credentialFields: {
      api_key: [
        { key: 'username', label: 'Username', placeholder: 'rest_api_user' },
        { key: 'password', label: 'Password', sensitive: true },
      ],
      oauth2: [
        { key: 'clientId', label: 'Client ID' },
        { key: 'clientSecret', label: 'Client Secret', sensitive: true },
        { key: 'username', label: 'Username', placeholder: 'rest_api_user' },
        { key: 'password', label: 'Password', sensitive: true },
        { key: 'tokenUrl', label: 'Token URL' },
      ],
    },
  },
  {
    value: 'datadog',
    label: 'Datadog',
    authMethods: ['api_key'],
    credentialFields: {
      api_key: [
        { key: 'apiKey', label: 'API Key', sensitive: true },
        { key: 'appKey', label: 'Application Key', sensitive: true },
      ],
    },
  },
  {
    value: 'pagerduty',
    label: 'PagerDuty',
    authMethods: ['api_key', 'bearer_token'],
    credentialFields: {
      api_key: [{ key: 'apiKey', label: 'API Key', sensitive: true }],
      bearer_token: [{ key: 'token', label: 'Bearer Token', sensitive: true }],
    },
  },
  {
    value: 'cloudflare',
    label: 'Cloudflare',
    authMethods: ['api_key', 'bearer_token'],
    credentialFields: {
      api_key: [
        { key: 'email', label: 'Email', placeholder: 'user@example.com' },
        { key: 'apiKey', label: 'API Key', sensitive: true },
      ],
      bearer_token: [{ key: 'token', label: 'API Token', sensitive: true }],
    },
  },
  {
    value: 'graph',
    label: 'Microsoft Graph',
    authMethods: [],
    credentialFields: {},
  },
  {
    value: 'citrix',
    label: 'Citrix',
    authMethods: ['api_key', 'oauth2'],
    credentialFields: {
      api_key: [
        { key: 'domain', label: 'Domain', placeholder: 'CORP' },
        { key: 'username', label: 'Username', placeholder: 'read_only_admin' },
        { key: 'password', label: 'Password', sensitive: true },
      ],
      oauth2: [
        { key: 'customerId', label: 'Customer ID', placeholder: 'e.g. a1b2c3d4e5f6' },
        { key: 'clientId', label: 'Client ID', placeholder: 'API client ID' },
        { key: 'clientSecret', label: 'Client Secret', sensitive: true },
      ],
    },
  },
  {
    value: 'splunk',
    label: 'Splunk',
    authMethods: ['bearer_token', 'api_key'],
    credentialFields: {
      bearer_token: [{ key: 'splunkToken', label: 'Splunk Token', sensitive: true }],
      api_key: [
        { key: 'username', label: 'Username', placeholder: 'sonde_svc' },
        { key: 'password', label: 'Password', sensitive: true },
      ],
    },
  },
  {
    value: 'proxmox',
    label: 'Proxmox VE',
    authMethods: ['api_key'],
    credentialFields: {
      api_key: [
        { key: 'tokenId', label: 'API Token ID', placeholder: 'sonde@pve!sonde-token' },
        { key: 'tokenSecret', label: 'API Token Secret', sensitive: true },
      ],
    },
  },
  {
    value: 'custom',
    label: 'Custom',
    authMethods: ['api_key', 'bearer_token', 'oauth2'],
    credentialFields: {
      api_key: [{ key: 'apiKey', label: 'API Key', sensitive: true }],
      bearer_token: [{ key: 'token', label: 'Bearer Token', sensitive: true }],
      oauth2: [
        { key: 'clientId', label: 'Client ID' },
        { key: 'clientSecret', label: 'Client Secret', sensitive: true },
        { key: 'tokenUrl', label: 'Token URL' },
      ],
    },
  },
];

const AUTH_METHOD_LABELS: Record<string, string> = {
  api_key: 'API Key',
  bearer_token: 'Bearer Token',
  oauth2: 'OAuth 2.0',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-400',
  error: 'bg-red-400',
  untested: 'bg-amber-400',
};

const STATUS_TEXT_COLORS: Record<string, string> = {
  active: 'text-emerald-400',
  error: 'text-red-400',
  untested: 'text-amber-400',
};

interface IntegrationEvent {
  id: number;
  integrationId: string;
  eventType: string;
  status: string | null;
  message: string | null;
  detailJson: string | null;
  createdAt: string;
}

interface Integration {
  id: string;
  type: string;
  name: string;
  status: string;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  createdAt: string;
}

export function IntegrationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Test connection
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);

  // Config editing
  const [editingConfig, setEditingConfig] = useState(false);
  const [editEndpoint, setEditEndpoint] = useState('');
  const [editHeadersText, setEditHeadersText] = useState('');
  const [editTlsSkipVerify, setEditTlsSkipVerify] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // Credentials editing
  const [editingCreds, setEditingCreds] = useState(false);
  const [editAuthMethod, setEditAuthMethod] = useState('');
  const [editCredValues, setEditCredValues] = useState<Record<string, string>>({});
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
  const [savingCreds, setSavingCreds] = useState(false);

  // Delete
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const fetchIntegration = useCallback(() => {
    if (!id) return;
    apiFetch<Integration>(`/integrations/${id}`)
      .then(setIntegration)
      .catch(() => setError('Integration not found'));
  }, [id]);

  const fetchEvents = useCallback(() => {
    if (!id) return;
    apiFetch<{ events: IntegrationEvent[] }>(`/integrations/${id}/events?limit=50`)
      .then((data) => setEvents(data.events))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    fetchIntegration();
    fetchEvents();
  }, [fetchIntegration, fetchEvents]);

  const typeDef = integration ? INTEGRATION_TYPES.find((t) => t.value === integration.type) : null;

  const handleTest = async () => {
    if (!id) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<{ success: boolean; message?: string }>(
        `/integrations/${id}/test`,
        { method: 'POST' },
      );
      setTestResult(result);
      fetchIntegration();
      fetchEvents();
      if (result.success) {
        toast('Connection test passed', 'success');
      } else if (result.message?.includes('No pack definition')) {
        toast('Integration pack not yet available — credentials saved', 'info');
      } else {
        toast(result.message || 'Connection test failed', 'error');
      }
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to test connection', 'error');
    } finally {
      setTesting(false);
    }
  };

  const parseHeaders = (text: string): Record<string, string> => {
    const headers: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        headers[trimmed.slice(0, colonIdx).trim()] = trimmed.slice(colonIdx + 1).trim();
      }
    }
    return headers;
  };

  const handleSaveConfig = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSavingConfig(true);
    try {
      const headers = parseHeaders(editHeadersText);
      await apiFetch(`/integrations/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          config: {
            endpoint: editEndpoint.trim(),
            ...(Object.keys(headers).length > 0 ? { headers } : {}),
            ...(editTlsSkipVerify ? { tlsRejectUnauthorized: false } : {}),
          },
        }),
      });
      setEditingConfig(false);
      fetchIntegration();
      fetchEvents();
      toast('Configuration updated', 'success');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to update config', 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSaveCreds = async (e: FormEvent) => {
    e.preventDefault();
    if (!id || !integration) return;
    setSavingCreds(true);
    try {
      await apiFetch(`/integrations/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          credentials: {
            packName: integration.type,
            authMethod: editAuthMethod,
            credentials: { ...editCredValues },
          },
        }),
      });
      setEditingCreds(false);
      setEditCredValues({});
      setVisibleFields(new Set());
      fetchIntegration();
      fetchEvents();
      toast('Credentials updated', 'success');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to update credentials', 'error');
    } finally {
      setSavingCreds(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !integration || deleteConfirmName !== integration.name) return;
    setDeleting(true);
    try {
      await apiFetch(`/integrations/${id}`, { method: 'DELETE' });
      toast('Integration deleted', 'success');
      navigate('/integrations');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to delete integration', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const toggleFieldVisibility = (key: string) => {
    setVisibleFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (error) {
    return (
      <div className="p-8">
        <button
          type="button"
          onClick={() => navigate('/integrations')}
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          &larr; Back to Integrations
        </button>
        <p className="mt-4 text-gray-400">{error}</p>
      </div>
    );
  }

  if (!integration) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  const typeLabel = typeDef?.label ?? integration.type;
  const credFields = typeDef?.credentialFields[editAuthMethod] ?? [];

  return (
    <div className="p-8">
      <button
        type="button"
        onClick={() => navigate('/integrations')}
        className="text-sm text-blue-400 hover:text-blue-300"
      >
        &larr; Back to Integrations
      </button>

      {/* Info card */}
      <div className="mt-4 rounded-xl border border-gray-800 bg-gray-900 p-6">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-3 w-3 rounded-full ${STATUS_COLORS[integration.status] ?? 'bg-gray-500'}`}
          />
          <h1 className="text-xl font-semibold text-white">{integration.name}</h1>
          <span className={`text-sm ${STATUS_TEXT_COLORS[integration.status] ?? 'text-gray-400'}`}>
            {integration.status}
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs uppercase text-gray-500">Type</dt>
            <dd className="mt-0.5 text-sm text-gray-300">{typeLabel}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-gray-500">Created</dt>
            <dd className="mt-0.5 text-sm text-gray-300">
              {new Date(integration.createdAt).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-gray-500">Last Tested</dt>
            <dd className="mt-0.5 text-sm text-gray-300">
              {integration.lastTestedAt ? relativeTime(integration.lastTestedAt) : 'Never'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-gray-500">ID</dt>
            <dd className="mt-0.5 text-sm text-gray-300 font-mono truncate">{integration.id}</dd>
          </div>
        </dl>
      </div>

      {/* Connection Status */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Connection Status</h2>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
        {integration.lastTestResult && !testResult && (
          <div
            className={`mt-3 rounded-lg border p-3 text-sm ${
              integration.lastTestResult === 'ok'
                ? 'border-emerald-800 bg-emerald-950/30 text-emerald-300'
                : 'border-red-800 bg-red-950/30 text-red-300'
            }`}
          >
            Last test: {integration.lastTestResult === 'ok' ? 'Passed' : integration.lastTestResult}
            {integration.lastTestedAt && (
              <span className="ml-2 text-gray-500">({relativeTime(integration.lastTestedAt)})</span>
            )}
          </div>
        )}
        {testResult && (
          <div
            className={`mt-3 rounded-lg border p-3 text-sm ${
              testResult.success
                ? 'border-emerald-800 bg-emerald-950/30 text-emerald-300'
                : testResult.message?.includes('No pack definition')
                  ? 'border-amber-800 bg-amber-950/30 text-amber-300'
                  : 'border-red-800 bg-red-950/30 text-red-300'
            }`}
          >
            {testResult.success
              ? 'Connection test passed'
              : testResult.message?.includes('No pack definition')
                ? 'The server-side integration pack for this type is not yet available. Your credentials have been saved and will be used once the pack is installed.'
                : `Connection test failed: ${testResult.message || 'Unknown error'}`}
          </div>
        )}
      </div>

      {/* Configuration */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Configuration</h2>
          {!editingConfig && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const data = await apiFetch<{ config: { endpoint?: string; headers?: Record<string, string>; tlsRejectUnauthorized?: boolean } }>(`/integrations/${id}/config`);
                  setEditEndpoint(data.config.endpoint ?? '');
                  const hdrs = data.config.headers;
                  setEditHeadersText(hdrs ? Object.entries(hdrs).map(([k, v]) => `${k}: ${v}`).join('\n') : '');
                  setEditTlsSkipVerify(data.config.tlsRejectUnauthorized === false);
                } catch {
                  setEditEndpoint('');
                  setEditHeadersText('');
                  setEditTlsSkipVerify(false);
                }
                setEditingConfig(true);
              }}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              Edit
            </button>
          )}
        </div>
        {editingConfig ? (
          <form
            onSubmit={handleSaveConfig}
            className="mt-3 space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4"
          >
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Endpoint URL</p>
              <input
                type="url"
                value={editEndpoint}
                onChange={(e) => setEditEndpoint(e.target.value)}
                placeholder="https://api.example.com"
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">
                Headers <span className="text-gray-600">(one per line: Key: Value)</span>
              </p>
              <textarea
                value={editHeadersText}
                onChange={(e) => setEditHeadersText(e.target.value)}
                placeholder="X-Custom-Header: value"
                rows={3}
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none font-mono"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <input
                type="checkbox"
                checked={editTlsSkipVerify}
                onChange={(e) => setEditTlsSkipVerify(e.target.checked)}
                className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
              />
              Skip TLS certificate verification (for self-signed certs)
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={savingConfig || !editEndpoint.trim()}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {savingConfig ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setEditingConfig(false)}
                className="rounded-md bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <p className="mt-2 text-sm text-gray-500">
            Configuration is encrypted. Click Edit to update.
          </p>
        )}
      </div>

      {/* Credentials */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Credentials</h2>
          {integration.type !== 'graph' && !editingCreds && (
            <button
              type="button"
              onClick={() => {
                setEditAuthMethod(typeDef?.authMethods[0] ?? 'api_key');
                setEditCredValues({});
                setVisibleFields(new Set());
                setEditingCreds(true);
              }}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              Edit
            </button>
          )}
        </div>
        {integration.type === 'graph' ? (
          <div className="mt-3 rounded-lg border border-blue-800 bg-blue-950/30 p-4 text-sm text-blue-300">
            Synced from Entra SSO configuration. Credentials update automatically when SSO settings
            change.
          </div>
        ) : editingCreds && typeDef ? (
          <form
            onSubmit={handleSaveCreds}
            className="mt-3 space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4"
          >
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Auth Method</p>
              <select
                value={editAuthMethod}
                onChange={(e) => {
                  setEditAuthMethod(e.target.value);
                  setEditCredValues({});
                  setVisibleFields(new Set());
                }}
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                {typeDef.authMethods.map((m) => (
                  <option key={m} value={m}>
                    {AUTH_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            {credFields.map((field) => (
              <div key={field.key}>
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">{field.label}</p>
                <div className="relative">
                  <input
                    type={field.sensitive && !visibleFields.has(field.key) ? 'password' : 'text'}
                    value={editCredValues[field.key] ?? ''}
                    onChange={(e) =>
                      setEditCredValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    placeholder={field.placeholder}
                    className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none pr-16"
                  />
                  {field.sensitive && (
                    <button
                      type="button"
                      onClick={() => toggleFieldVisibility(field.key)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300"
                    >
                      {visibleFields.has(field.key) ? 'Hide' : 'Show'}
                    </button>
                  )}
                </div>
              </div>
            ))}
            <p className="text-xs text-gray-500">
              All credential fields are required. Existing values cannot be displayed.
            </p>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={savingCreds || credFields.some((f) => !editCredValues[f.key]?.trim())}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {savingCreds ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setEditingCreds(false)}
                className="rounded-md bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : !editingCreds ? (
          <p className="mt-2 text-sm text-gray-500">
            Credentials are encrypted. Click Edit to update.
          </p>
        ) : null}
      </div>

      {/* Activity Log */}
      <ActivityLog events={events} />

      {/* Danger Zone */}
      <div className="mt-8 rounded-xl border border-red-900/50 bg-red-950/10 p-6">
        <h2 className="text-lg font-semibold text-red-400">Danger Zone</h2>
        <p className="mt-1 text-sm text-gray-400">
          Permanently delete this integration and its stored credentials.
        </p>
        {showDeleteConfirm ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-gray-300">
              Type <span className="font-mono text-red-400">{integration.name}</span> to confirm:
            </p>
            <input
              type="text"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={integration.name}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-red-500 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting || deleteConfirmName !== integration.name}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete Integration'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmName('');
                }}
                className="rounded-md bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="mt-4 rounded-md border border-red-900 bg-red-950/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-950/50"
          >
            Delete Integration
          </button>
        )}
      </div>
    </div>
  );
}

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
