import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiKeyGate } from '../components/common/ApiKeyGate';
import { useToast } from '../components/common/Toast';
import { authFetch } from '../hooks/useApiKey';

interface CredentialFieldDef {
  key: string;
  label: string;
  placeholder?: string;
  sensitive?: boolean;
}

interface IntegrationTypeDef {
  value: string;
  label: string;
  description: string;
  authMethods: Array<'api_key' | 'bearer_token' | 'oauth2'>;
  credentialFields: Record<string, CredentialFieldDef[]>;
}

const INTEGRATION_TYPES: IntegrationTypeDef[] = [
  {
    value: 'servicenow',
    label: 'ServiceNow',
    description: 'IT service management and incident response',
    authMethods: ['api_key', 'oauth2'],
    credentialFields: {
      api_key: [
        { key: 'username', label: 'Username', placeholder: 'admin' },
        { key: 'password', label: 'Password', sensitive: true },
      ],
      oauth2: [
        { key: 'clientId', label: 'Client ID' },
        { key: 'clientSecret', label: 'Client Secret', sensitive: true },
        { key: 'tokenUrl', label: 'Token URL', placeholder: 'https://instance.service-now.com/oauth_token.do' },
      ],
    },
  },
  {
    value: 'datadog',
    label: 'Datadog',
    description: 'Infrastructure monitoring and APM',
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
    description: 'Incident management and alerting',
    authMethods: ['api_key', 'bearer_token'],
    credentialFields: {
      api_key: [{ key: 'apiKey', label: 'API Key', sensitive: true }],
      bearer_token: [{ key: 'token', label: 'Bearer Token', sensitive: true }],
    },
  },
  {
    value: 'cloudflare',
    label: 'Cloudflare',
    description: 'CDN, DNS, and edge security',
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
    value: 'entra_id',
    label: 'Entra ID',
    description: 'Azure Active Directory identity management',
    authMethods: ['oauth2'],
    credentialFields: {
      oauth2: [
        { key: 'tenantId', label: 'Tenant ID' },
        { key: 'clientId', label: 'Client ID' },
        { key: 'clientSecret', label: 'Client Secret', sensitive: true },
      ],
    },
  },
  {
    value: 'citrix',
    label: 'Citrix',
    description: 'Virtual desktops and application delivery',
    authMethods: ['api_key', 'oauth2'],
    credentialFields: {
      api_key: [
        { key: 'customerId', label: 'Customer ID' },
        { key: 'clientId', label: 'Client ID' },
        { key: 'clientSecret', label: 'Client Secret', sensitive: true },
      ],
      oauth2: [
        { key: 'customerId', label: 'Customer ID' },
        { key: 'clientId', label: 'Client ID' },
        { key: 'clientSecret', label: 'Client Secret', sensitive: true },
        { key: 'tokenUrl', label: 'Token URL', placeholder: 'https://api.cloud.com/cctrustoauth2/...' },
      ],
    },
  },
  {
    value: 'custom',
    label: 'Custom',
    description: 'Connect to any REST API',
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
};

const STATUS_TEXT_COLORS: Record<string, string> = {
  active: 'text-emerald-400',
  error: 'text-red-400',
};

interface Integration {
  id: string;
  type: string;
  name: string;
  status: string;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  createdAt: string;
}

export function Integrations() {
  return <ApiKeyGate>{(apiKey) => <IntegrationsInner apiKey={apiKey} />}</ApiKeyGate>;
}

function IntegrationsInner({ apiKey }: { apiKey: string }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Multi-step form state
  const [step, setStep] = useState(1);
  const [selectedType, setSelectedType] = useState('');
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [authMethod, setAuthMethod] = useState('');
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const fetchIntegrations = useCallback(() => {
    setLoading(true);
    setError(null);
    authFetch<{ integrations: Integration[] }>('/integrations', apiKey)
      .then((data) => setIntegrations(data.integrations))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load integrations';
        setError(msg);
        toast(msg, 'error');
      })
      .finally(() => setLoading(false));
  }, [apiKey, toast]);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  const typeDef = INTEGRATION_TYPES.find((t) => t.value === selectedType);

  const resetForm = () => {
    setStep(1);
    setSelectedType('');
    setName('');
    setEndpoint('');
    setHeadersText('');
    setAuthMethod('');
    setCredentialValues({});
    setVisibleFields(new Set());
    setTestResult(null);
    setSavedId(null);
    setShowCreate(false);
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

  const buildPayload = () => {
    const headers = parseHeaders(headersText);
    return {
      type: selectedType,
      name: name.trim(),
      config: {
        endpoint: endpoint.trim(),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      },
      credentials: {
        packName: selectedType,
        authMethod,
        credentials: { ...credentialValues },
      },
    };
  };

  const saveIntegration = async (): Promise<string> => {
    if (savedId) return savedId;
    const data = await authFetch<{ id: string }>('/integrations', apiKey, {
      method: 'POST',
      body: JSON.stringify(buildPayload()),
    });
    setSavedId(data.id);
    fetchIntegrations();
    return data.id;
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveIntegration();
      resetForm();
      toast('Integration created', 'success');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to create integration', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const id = await saveIntegration();
      const result = await authFetch<{ success: boolean; message?: string }>(
        `/integrations/${id}/test`,
        apiKey,
        { method: 'POST' },
      );
      setTestResult(result);
      if (result.success) {
        toast('Connection test passed', 'success');
      } else {
        toast(result.message || 'Connection test failed', 'error');
      }
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to test connection', 'error');
    } finally {
      setTesting(false);
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

  const setCredential = (key: string, value: string) => {
    setCredentialValues((prev) => ({ ...prev, [key]: value }));
  };

  const canAdvanceToStep2 = !!selectedType;
  const canAdvanceToStep3 = !!name.trim() && !!endpoint.trim();
  const currentFields = typeDef?.credentialFields[authMethod] ?? [];
  const canAdvanceToStep4 =
    !!authMethod && currentFields.every((f) => !!credentialValues[f.key]?.trim());

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-white">Integrations</h1>
        <p className="mt-4 text-red-400">{error}</p>
        <button
          type="button"
          onClick={fetchIntegrations}
          className="mt-2 rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Integrations</h1>
          <p className="mt-1 text-sm text-gray-400">
            {integrations.length} integration{integrations.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (showCreate) {
              resetForm();
            } else {
              setShowCreate(true);
            }
          }}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          {showCreate ? 'Cancel' : 'Add Integration'}
        </button>
      </div>

      {/* Multi-step create form */}
      {showCreate && (
        <div className="mt-4 rounded-xl border border-gray-800 bg-gray-900 p-6">
          {/* Step indicator */}
          <div className="mb-6 flex items-center justify-center gap-2">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (s < step) setStep(s);
                  }}
                  disabled={s > step}
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                    s === step
                      ? 'bg-blue-600 text-white'
                      : s < step
                        ? 'bg-blue-600/30 text-blue-300 hover:bg-blue-600/50'
                        : 'bg-gray-800 text-gray-500'
                  }`}
                >
                  {s}
                </button>
                {s < 4 && (
                  <div
                    className={`h-px w-8 ${s < step ? 'bg-blue-600/50' : 'bg-gray-700'}`}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Step 1: Select Type */}
          {step === 1 && (
            <div>
              <h3 className="text-lg font-medium text-white">Select Integration Type</h3>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {INTEGRATION_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => {
                      setSelectedType(t.value);
                      setAuthMethod(t.authMethods[0]);
                      setCredentialValues({});
                    }}
                    className={`rounded-lg border p-4 text-left transition-colors ${
                      selectedType === t.value
                        ? 'border-blue-500 bg-blue-950/30'
                        : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                    }`}
                  >
                    <p className="font-medium text-white">{t.label}</p>
                    <p className="mt-1 text-xs text-gray-400">{t.description}</p>
                  </button>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  disabled={!canAdvanceToStep2}
                  onClick={() => setStep(2)}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Name & Endpoint */}
          {step === 2 && (
            <div>
              <h3 className="text-lg font-medium text-white">Configuration</h3>
              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase mb-1">Name</p>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. production-datadog"
                    className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase mb-1">Endpoint URL</p>
                  <input
                    type="url"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder="https://api.example.com"
                    className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase mb-1">
                    Headers <span className="text-gray-600">(optional, one per line: Key: Value)</span>
                  </p>
                  <textarea
                    value={headersText}
                    onChange={(e) => setHeadersText(e.target.value)}
                    placeholder="X-Custom-Header: value"
                    rows={3}
                    className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none font-mono"
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-md bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!canAdvanceToStep3}
                  onClick={() => setStep(3)}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Auth & Credentials */}
          {step === 3 && typeDef && (
            <div>
              <h3 className="text-lg font-medium text-white">Credentials</h3>
              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase mb-1">Auth Method</p>
                  <select
                    value={authMethod}
                    onChange={(e) => {
                      setAuthMethod(e.target.value);
                      setCredentialValues({});
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
                {currentFields.map((field) => (
                  <div key={field.key}>
                    <p className="text-xs font-medium text-gray-500 uppercase mb-1">{field.label}</p>
                    <div className="relative">
                      <input
                        type={field.sensitive && !visibleFields.has(field.key) ? 'password' : 'text'}
                        value={credentialValues[field.key] ?? ''}
                        onChange={(e) => setCredential(field.key, e.target.value)}
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
              </div>
              <div className="mt-4 flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-md bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!canAdvanceToStep4}
                  onClick={() => setStep(4)}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Review & Save */}
          {step === 4 && typeDef && (
            <div>
              <h3 className="text-lg font-medium text-white">Review</h3>
              <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <dt className="text-xs uppercase text-gray-500">Type</dt>
                  <dd className="mt-0.5 text-sm text-gray-300">{typeDef.label}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-gray-500">Name</dt>
                  <dd className="mt-0.5 text-sm text-gray-300">{name}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-gray-500">Endpoint</dt>
                  <dd className="mt-0.5 text-sm text-gray-300 truncate">{endpoint}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-gray-500">Auth Method</dt>
                  <dd className="mt-0.5 text-sm text-gray-300">{AUTH_METHOD_LABELS[authMethod]}</dd>
                </div>
              </dl>

              {/* Test result banner */}
              {testResult && (
                <div
                  className={`mt-4 rounded-lg border p-3 text-sm ${
                    testResult.success
                      ? 'border-emerald-800 bg-emerald-950/30 text-emerald-300'
                      : 'border-red-800 bg-red-950/30 text-red-300'
                  }`}
                >
                  {testResult.success
                    ? 'Connection test passed'
                    : `Connection test failed: ${testResult.message || 'Unknown error'}`}
                </div>
              )}

              <div className="mt-4 flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="rounded-md bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
                >
                  Back
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleTest}
                    disabled={testing || saving}
                    className="rounded-md border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                  >
                    {testing ? 'Testing...' : 'Test Connection'}
                  </button>
                  {savedId ? (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                    >
                      Done
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving || testing}
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Integrations table */}
      <div className="mt-6 overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last Tested</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {integrations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  No integrations configured yet.
                </td>
              </tr>
            ) : (
              integrations.map((intg) => {
                const typeLabel =
                  INTEGRATION_TYPES.find((t) => t.value === intg.type)?.label ?? intg.type;
                return (
                  <tr
                    key={intg.id}
                    onClick={() => navigate(`/integrations/${intg.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/integrations/${intg.id}`);
                    }}
                    className="cursor-pointer bg-gray-950 transition-colors hover:bg-gray-900"
                  >
                    <td className="px-4 py-3 font-medium text-white">{intg.name}</td>
                    <td className="px-4 py-3 text-gray-400">{typeLabel}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[intg.status] ?? 'bg-gray-500'}`}
                        />
                        <span className={STATUS_TEXT_COLORS[intg.status] ?? 'text-gray-400'}>
                          {intg.status}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {intg.lastTestedAt ? relativeTime(intg.lastTestedAt) : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(intg.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
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
