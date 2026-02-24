import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CsvImportModal } from '../components/common/CsvImportModal';
import { TagInput } from '../components/common/TagInput';
import { useToast } from '../components/common/Toast';
import { KeeperFieldInput } from '../components/integration/KeeperFieldInput';
import { apiFetch } from '../lib/api';

interface CredentialFieldDef {
  key: string;
  label: string;
  placeholder?: string;
  sensitive?: boolean;
  tooltip?: string;
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
    description:
      'CMDB lookup, incidents, changes, and ownership. Requires snc_read_only + itil roles.',
    authMethods: ['api_key', 'oauth2'],
    credentialFields: {
      api_key: [
        {
          key: 'username',
          label: 'Username',
          placeholder: 'rest_api_user',
          tooltip: 'ServiceNow user with snc_read_only and itil roles',
        },
        {
          key: 'password',
          label: 'Password',
          placeholder: 'ServiceNow account password',
          sensitive: true,
          tooltip: 'Password for the ServiceNow user account',
        },
      ],
      oauth2: [
        {
          key: 'clientId',
          label: 'Client ID',
          placeholder: 'OAuth application client ID',
          tooltip: 'From System OAuth > Application Registry in ServiceNow',
        },
        {
          key: 'clientSecret',
          label: 'Client Secret',
          sensitive: true,
          tooltip: 'Client secret from the OAuth application',
        },
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
        {
          key: 'apiKey',
          label: 'API Key',
          placeholder: 'Datadog API key (32 hex characters)',
          sensitive: true,
          tooltip: 'Organization Settings → API Keys. Identifies your Datadog organization.',
        },
        {
          key: 'appKey',
          label: 'Application Key',
          placeholder: 'Datadog Application key (40 characters)',
          sensitive: true,
          tooltip:
            "Organization Settings → Application Keys. Scoped to the creating user's permissions.",
        },
      ],
    },
  },
  {
    value: 'pagerduty',
    label: 'PagerDuty',
    description: 'Incident management and alerting',
    authMethods: ['bearer_token'],
    credentialFields: {
      bearer_token: [
        {
          key: 'token',
          label: 'REST API Key',
          placeholder: 'e.g. y_NbAkKc66ryYTWUXYEu',
          sensitive: true,
          tooltip:
            'Integrations → Developer Tools → API Access Keys. Use a General Access or Personal REST API key (20 chars). NOT an Events API key.',
        },
      ],
    },
  },
  {
    value: 'cloudflare',
    label: 'Cloudflare',
    description: 'CDN, DNS, and edge security',
    authMethods: ['api_key', 'bearer_token'],
    credentialFields: {
      api_key: [
        {
          key: 'email',
          label: 'Account Email',
          placeholder: 'user@example.com',
          tooltip: 'Email address associated with your Cloudflare account',
        },
        {
          key: 'apiKey',
          label: 'Global API Key',
          placeholder: 'Cloudflare Global API Key (37 hex characters)',
          sensitive: true,
          tooltip: 'Profile → API Tokens → Global API Key',
        },
      ],
      bearer_token: [
        {
          key: 'token',
          label: 'API Token',
          placeholder: 'Scoped API token from Cloudflare dashboard',
          sensitive: true,
          tooltip: 'Profile → API Tokens → Create Token with scoped permissions',
        },
      ],
    },
  },
  {
    value: 'graph',
    label: 'Microsoft Graph',
    description:
      'Entra ID users, sign-in logs, risky users, Intune device compliance. Uses Entra SSO — no separate credentials.',
    authMethods: [],
    credentialFields: {},
  },
  {
    value: 'citrix',
    label: 'Citrix',
    description:
      'Citrix Monitor OData — sessions, logon perf, machine status, delivery groups. On-prem: Director read-only admin. Cloud: API client with Monitor scope.',
    authMethods: ['api_key', 'oauth2'],
    credentialFields: {
      api_key: [
        {
          key: 'domain',
          label: 'Domain',
          placeholder: 'CORP (NTLM domain for Director auth)',
          tooltip: 'Active Directory domain for NTLM authentication (e.g. CORP)',
        },
        {
          key: 'username',
          label: 'Username',
          placeholder: 'read_only_admin',
          tooltip: 'Director admin account with read-only monitoring access',
        },
        {
          key: 'password',
          label: 'Password',
          placeholder: 'Director account password',
          sensitive: true,
          tooltip: 'Password for the Director admin account',
        },
      ],
      oauth2: [
        {
          key: 'customerId',
          label: 'Customer ID',
          placeholder: 'e.g. a1b2c3d4e5f6',
          tooltip: 'Citrix Cloud → Identity and Access Management → API Access',
        },
        {
          key: 'clientId',
          label: 'Client ID',
          placeholder: 'API client ID from Citrix Cloud',
          tooltip: 'API client ID from the Citrix Cloud console',
        },
        {
          key: 'clientSecret',
          label: 'Client Secret',
          placeholder: 'API client secret',
          sensitive: true,
          tooltip: 'API client secret — shown once at creation',
        },
      ],
    },
  },
  {
    value: 'splunk',
    label: 'Splunk',
    description:
      'Splunk Enterprise — SPL search, indexes, saved searches, health. Requires a role with search + rest_properties_get capabilities.',
    authMethods: ['bearer_token', 'api_key'],
    credentialFields: {
      bearer_token: [
        {
          key: 'splunkToken',
          label: 'Splunk Token',
          placeholder: 'Settings > Tokens (NOT a HEC token)',
          sensitive: true,
          tooltip:
            'Settings → Tokens → New Token. Requires search and rest_properties_get capabilities. NOT a HEC token.',
        },
      ],
      api_key: [
        {
          key: 'username',
          label: 'Username',
          placeholder: 'sonde_svc',
          tooltip: 'Splunk local user with search and rest_properties_get capabilities',
        },
        {
          key: 'password',
          label: 'Password',
          placeholder: 'Splunk account password',
          sensitive: true,
          tooltip: 'Password for the Splunk user account',
        },
      ],
    },
  },
  {
    value: 'proxmox',
    label: 'Proxmox VE',
    description:
      'Proxmox VE cluster — nodes, VMs, containers, storage, Ceph, and HA status. Requires API token with audit privileges.',
    authMethods: ['api_key'],
    credentialFields: {
      api_key: [
        {
          key: 'tokenId',
          label: 'API Token ID',
          placeholder: 'sonde@pve!sonde-token',
          tooltip: 'Format: user@realm!token-name (e.g. sonde@pve!sonde-token)',
        },
        {
          key: 'tokenSecret',
          label: 'API Token Secret',
          placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
          sensitive: true,
          tooltip: 'Shown once at token creation. UUID format.',
        },
      ],
    },
  },
  {
    value: 'nutanix',
    label: 'Nutanix',
    description:
      'Nutanix Prism Central — clusters, VMs, hosts, alerts, storage, and categories via v4 API. Requires Prism Viewer role.',
    authMethods: ['api_key', 'bearer_token'],
    credentialFields: {
      api_key: [
        {
          key: 'username',
          label: 'Username',
          placeholder: 'sonde_viewer',
          tooltip: 'Prism Central local user with Viewer role',
        },
        {
          key: 'password',
          label: 'Password',
          placeholder: 'Prism Central account password',
          sensitive: true,
          tooltip: 'Password for the Prism Central user account',
        },
      ],
      bearer_token: [
        {
          key: 'nutanixApiKey',
          label: 'API Key',
          placeholder: 'Prism Central IAM API key',
          sensitive: true,
          tooltip: 'Prism Central → Admin → IAM → API Keys',
        },
      ],
    },
  },
  {
    value: 'vcenter',
    label: 'VMware vCenter',
    description:
      'VMware vCenter — VMs, ESXi hosts, datastores, clusters, and health. Requires a read-only vSphere account.',
    authMethods: ['api_key'],
    credentialFields: {
      api_key: [
        {
          key: 'username',
          label: 'Username',
          placeholder: 'sonde@vsphere.local',
          tooltip: 'vSphere SSO account (e.g. sonde@vsphere.local) with a read-only role',
        },
        {
          key: 'password',
          label: 'Password',
          placeholder: 'vSphere SSO account password',
          sensitive: true,
          tooltip: 'Password for the vSphere SSO account',
        },
      ],
    },
  },
  {
    value: 'jira',
    label: 'Jira',
    description:
      'Atlassian Jira Cloud — JQL search, issue details, changelog, and projects. Requires an API token.',
    authMethods: ['api_key'],
    credentialFields: {
      api_key: [
        {
          key: 'email',
          label: 'Email',
          placeholder: 'user@example.com',
          tooltip: 'Atlassian account email that owns the API token',
        },
        {
          key: 'apiToken',
          label: 'API Token',
          placeholder: 'Atlassian API token',
          sensitive: true,
          tooltip: 'id.atlassian.com → Security → API tokens. Max 365-day expiry.',
        },
      ],
    },
  },
  {
    value: 'loki',
    label: 'Grafana Loki',
    description:
      'Grafana Loki — LogQL queries, label discovery, and series matching. Supports Grafana Cloud and self-hosted.',
    authMethods: ['api_key', 'bearer_token'],
    credentialFields: {
      api_key: [
        {
          key: 'username',
          label: 'Username',
          placeholder: 'Loki instance ID or username',
          tooltip:
            'Grafana Cloud: Loki instance ID (numeric). Self-hosted: proxy-configured username.',
        },
        {
          key: 'password',
          label: 'Password',
          placeholder: 'Service account token or password',
          sensitive: true,
          tooltip: 'Grafana Cloud: service account token. Self-hosted: proxy-configured password.',
        },
      ],
      bearer_token: [
        {
          key: 'token',
          label: 'Bearer Token',
          placeholder: 'Service account token',
          sensitive: true,
          tooltip: 'Bearer token for auth. Grafana Cloud: use a service account token.',
        },
      ],
    },
  },
  {
    value: 'thousandeyes',
    label: 'ThousandEyes',
    description: 'Network path analysis, latency metrics, and internet outage detection',
    authMethods: ['bearer_token'],
    credentialFields: {
      bearer_token: [
        {
          key: 'token',
          label: 'API Bearer Token',
          placeholder: 'ThousandEyes API bearer token',
          sensitive: true,
          tooltip: 'Account Settings → Users and Roles → Profile → User API Tokens. Requires MFA.',
        },
      ],
    },
  },
  {
    value: 'meraki',
    label: 'Cisco Meraki',
    description: 'Device fleet status, switch port diagnostics, and network topology',
    authMethods: ['bearer_token'],
    credentialFields: {
      bearer_token: [
        {
          key: 'apiKey',
          label: 'API Key',
          placeholder: 'Meraki Dashboard API key',
          sensitive: true,
          tooltip: 'Meraki Dashboard → My Profile → API access → Generate API key.',
        },
        {
          key: 'orgId',
          label: 'Organization ID',
          placeholder: 'e.g. 549236',
          tooltip: 'Organization → Settings → Organization Info, or from organizations.list probe.',
        },
      ],
    },
  },
  {
    value: 'checkpoint',
    label: 'Check Point',
    description: 'Firewall gateways, access policies, network objects, and management tasks',
    authMethods: ['api_key'],
    credentialFields: {
      api_key: [
        {
          key: 'username',
          label: 'Username',
          placeholder: 'SmartConsole admin username',
          tooltip: 'SmartConsole admin with read-only permissions',
        },
        {
          key: 'password',
          label: 'Password',
          placeholder: 'Admin account password',
          sensitive: true,
          tooltip: 'Password or API key for the admin account',
        },
      ],
    },
  },
  {
    value: 'a10',
    label: 'A10 Networks',
    description: 'Load balancer diagnostics — virtual servers, service groups, real server health',
    authMethods: ['api_key'],
    credentialFields: {
      api_key: [
        {
          key: 'username',
          label: 'Username',
          placeholder: 'A10 ACOS admin username',
          tooltip: 'A10 ACOS admin account with read-only partition access',
        },
        {
          key: 'password',
          label: 'Password',
          placeholder: 'Admin account password',
          sensitive: true,
          tooltip: 'Password for the admin account',
        },
      ],
    },
  },
  {
    value: 'unifi',
    label: 'UniFi Network',
    description: 'Devices, clients, networks, WAN, device stats (official API)',
    authMethods: ['api_key'],
    credentialFields: {
      api_key: [
        {
          key: 'apiKey',
          label: 'API Key',
          placeholder: 'UniFi Network API key',
          sensitive: true,
          tooltip: 'Generate in Network > Settings > Control Plane > Integrations',
        },
      ],
    },
  },
  {
    value: 'unifi-access',
    label: 'UniFi Access',
    description: 'Door status, access event logs, reader and hub devices',
    authMethods: ['api_key'],
    credentialFields: {
      api_key: [
        {
          key: 'apiToken',
          label: 'API Token',
          placeholder: 'UniFi Access API token',
          sensitive: true,
          tooltip: 'Bearer token from UniFi Access settings (Developer API)',
        },
      ],
    },
  },
  {
    value: 'keeper',
    label: 'Keeper Secrets Manager',
    description: 'Pull credentials from Keeper vault for use in other integrations',
    authMethods: ['api_key'],
    credentialFields: {
      api_key: [
        {
          key: 'oneTimeToken',
          label: 'One-Time Access Token',
          placeholder: 'XX:XXXXXX',
          sensitive: true,
          tooltip:
            'Generate in Keeper Vault > Secrets Manager > Applications. This token is used once to create a device binding.',
        },
      ],
    },
  },
  {
    value: 'custom',
    label: 'Custom',
    description: 'Connect to any REST API',
    authMethods: ['api_key', 'bearer_token', 'oauth2'],
    credentialFields: {
      api_key: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your API key', sensitive: true }],
      bearer_token: [
        { key: 'token', label: 'Bearer Token', placeholder: 'Your bearer token', sensitive: true },
      ],
      oauth2: [
        { key: 'clientId', label: 'Client ID', placeholder: 'OAuth client ID' },
        { key: 'clientSecret', label: 'Client Secret', sensitive: true },
        {
          key: 'tokenUrl',
          label: 'Token URL',
          placeholder: 'https://auth.example.com/oauth/token',
        },
      ],
    },
  },
];

const ENDPOINT_PLACEHOLDERS: Record<string, string> = {
  servicenow: 'https://instance.service-now.com',
  datadog: 'https://api.datadoghq.com',
  pagerduty: 'https://api.pagerduty.com',
  cloudflare: 'https://api.cloudflare.com/client/v4',
  graph: 'https://graph.microsoft.com/v1.0',
  citrix: 'https://director.company.com',
  splunk: 'https://splunk.company.com:8089',
  proxmox: 'https://pve01.local:8006',
  nutanix: 'https://prism-central.company.com:9440',
  vcenter: 'https://vcenter.company.com',
  jira: 'https://your-domain.atlassian.net',
  loki: 'https://logs-prod-us-central1.grafana.net',
  thousandeyes: 'https://api.thousandeyes.com',
  meraki: 'https://api.meraki.com',
  checkpoint: 'https://mgmt-server.corp.local',
  a10: 'https://thunder01.corp.local',
  unifi: 'https://192.168.1.1',
  'unifi-access': 'https://192.168.1.1/proxy/access/api/v1/developer/',
  keeper: 'keepersecurity.com',
  custom: 'https://api.example.com',
};

const ENDPOINT_TOOLTIPS: Record<string, string> = {
  servicenow: 'Your ServiceNow instance URL',
  datadog: 'US1: api.datadoghq.com · EU: api.datadoghq.eu · US3/US5/AP1/AP2/Gov also available',
  pagerduty: 'Always https://api.pagerduty.com for all accounts',
  cloudflare: 'Always https://api.cloudflare.com/client/v4',
  citrix: 'On-prem: Director server URL. Cloud: https://api.cloud.com/monitorodata',
  splunk: 'Splunk management port — typically :8089, not the web UI port (:8000)',
  proxmox: 'Any PVE node or cluster VIP. Default port 8006. Self-signed cert is common.',
  nutanix: 'Prism Central URL. Default port 9440. Self-signed cert is common.',
  vcenter: 'vCenter Server FQDN or IP. Port 443 is default.',
  jira: 'Your Jira Cloud site URL (e.g. https://your-domain.atlassian.net)',
  loki: 'Grafana Cloud: logs-prod-<region>.grafana.net. Self-hosted: your Loki HTTP URL.',
  thousandeyes: 'Always https://api.thousandeyes.com for all accounts',
  meraki: 'Always https://api.meraki.com for all accounts',
  checkpoint: 'Check Point Management Server IP/hostname. Default port 443.',
  a10: 'A10 Thunder/vThunder management IP. Default port 443.',
  unifi:
    'Your UDM/UDM-Pro IP (e.g. https://192.168.1.1). Requires Network App 9.0.108+. Self-signed cert is common.',
  'unifi-access':
    'Through UDM: https://ip/proxy/access/api/v1/developer/. Direct: https://host:12445/api/v1/developer/.',
  keeper: 'Keeper region endpoint. Auto-set based on region selection.',
};

const NAME_PLACEHOLDERS: Record<string, string> = {
  servicenow: 'e.g. prod-servicenow',
  datadog: 'e.g. prod-datadog',
  pagerduty: 'e.g. prod-pagerduty',
  cloudflare: 'e.g. prod-cloudflare',
  graph: 'e.g. entra-graph',
  citrix: 'e.g. prod-citrix',
  splunk: 'e.g. prod-splunk',
  proxmox: 'e.g. pve-cluster-01',
  nutanix: 'e.g. prism-central-01',
  vcenter: 'e.g. vcenter-prod',
  jira: 'e.g. jira-cloud',
  loki: 'e.g. grafana-loki-prod',
  thousandeyes: 'e.g. prod-thousandeyes',
  meraki: 'e.g. meraki-prod',
  checkpoint: 'e.g. checkpoint-mgmt-01',
  a10: 'e.g. a10-thunder-01',
  unifi: 'e.g. unifi-home',
  'unifi-access': 'e.g. unifi-access-office',
  keeper: 'e.g. keeper-vault',
  custom: 'e.g. my-integration',
};

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

interface Integration {
  id: string;
  type: string;
  name: string;
  status: string;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  createdAt: string;
  tags: string[];
}

function matchesSearch(integration: Integration, query: string): boolean {
  const q = query.toLowerCase();
  const typeLabel =
    INTEGRATION_TYPES.find((t) => t.value === integration.type)?.label ?? integration.type;
  return (
    integration.name.toLowerCase().includes(q) ||
    integration.type.toLowerCase().includes(q) ||
    typeLabel.toLowerCase().includes(q) ||
    integration.status.toLowerCase().includes(q) ||
    integration.tags.some((t) => t.toLowerCase().includes(q))
  );
}

export function Integrations() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'add' | 'remove' | null>(null);
  const [bulkTagValue, setBulkTagValue] = useState('');
  const [showCsvImport, setShowCsvImport] = useState(false);

  // Multi-step form state
  const [step, setStep] = useState(1);
  const [selectedType, setSelectedType] = useState('');
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [tlsSkipVerify, setTlsSkipVerify] = useState(false);
  const [authMethod, setAuthMethod] = useState('');
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [ssoStatus, setSsoStatus] = useState<{ configured: boolean; enabled: boolean } | null>(
    null,
  );
  const [keeperIntegrations, setKeeperIntegrations] = useState<Array<{ id: string; name: string }>>(
    [],
  );

  const fetchIntegrations = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<{ integrations: Integration[] }>('/integrations')
      .then((data) => setIntegrations(data.integrations))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load integrations';
        setError(msg);
        toast(msg, 'error');
      })
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  useEffect(() => {
    if (selectedType === 'graph') {
      apiFetch<{ configured: boolean; enabled: boolean }>('/sso/status')
        .then(setSsoStatus)
        .catch(() => setSsoStatus(null));
    }
  }, [selectedType]);

  useEffect(() => {
    if (showCreate) {
      apiFetch<{ integrations: Array<{ id: string; name: string; type: string }> }>('/integrations')
        .then((d) => setKeeperIntegrations(d.integrations.filter((i) => i.type === 'keeper')))
        .catch(() => setKeeperIntegrations([]));
    }
  }, [showCreate]);

  const typeDef = INTEGRATION_TYPES.find((t) => t.value === selectedType);

  const resetForm = () => {
    setStep(1);
    setSelectedType('');
    setName('');
    setEndpoint('');
    setHeadersText('');
    setTlsSkipVerify(false);
    setAuthMethod('');
    setCredentialValues({});
    setVisibleFields(new Set());
    setTestResult(null);
    setSavedId(null);
    setSsoStatus(null);
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
        ...(tlsSkipVerify ? { tlsRejectUnauthorized: false } : {}),
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
    if (selectedType === 'graph') {
      const data = await apiFetch<{ id: string }>('/integrations/graph/activate', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      setSavedId(data.id);
      fetchIntegrations();
      return data.id;
    }
    if (selectedType === 'keeper') {
      const data = await apiFetch<{ id: string }>('/integrations/keeper/initialize', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          oneTimeToken: credentialValues.oneTimeToken,
          region: endpoint.trim() || undefined,
        }),
      });
      setSavedId(data.id);
      fetchIntegrations();
      return data.id;
    }
    const data = await apiFetch<{ id: string }>('/integrations', {
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
      const result = await apiFetch<{ success: boolean; message?: string }>(
        `/integrations/${id}/test`,
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
  const canAdvanceToStep3 =
    selectedType === 'graph' || selectedType === 'keeper'
      ? !!name.trim()
      : !!name.trim() && !!endpoint.trim();
  const currentFields = typeDef?.credentialFields[authMethod] ?? [];
  const canAdvanceToStep4 =
    selectedType === 'graph'
      ? !!(ssoStatus?.configured && ssoStatus?.enabled)
      : !!authMethod && currentFields.every((f) => !!credentialValues[f.key]?.trim());

  const filtered = search ? integrations.filter((i) => matchesSearch(i, search)) : integrations;

  const allVisibleSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((i) => i.id)));
    }
  };

  const handleTagAdd = async (integrationId: string, tag: string) => {
    try {
      await apiFetch(`/integrations/${integrationId}/tags`, {
        method: 'PUT',
        body: JSON.stringify({
          tags: [...(integrations.find((i) => i.id === integrationId)?.tags ?? []), tag],
        }),
      });
      fetchIntegrations();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to add tag', 'error');
    }
  };

  const handleTagRemove = async (integrationId: string, tag: string) => {
    const integration = integrations.find((i) => i.id === integrationId);
    if (!integration) return;
    try {
      await apiFetch(`/integrations/${integrationId}/tags`, {
        method: 'PUT',
        body: JSON.stringify({
          tags: integration.tags.filter((t) => t !== tag),
        }),
      });
      fetchIntegrations();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to remove tag', 'error');
    }
  };

  const handleBulkTag = async () => {
    const tag = bulkTagValue.trim();
    if (!tag || selected.size === 0) return;

    try {
      await apiFetch('/integrations/tags', {
        method: 'PATCH',
        body: JSON.stringify({
          ids: [...selected],
          ...(bulkAction === 'add' ? { add: [tag] } : { remove: [tag] }),
        }),
      });
      toast(
        `Tag '${tag}' ${bulkAction === 'add' ? 'added to' : 'removed from'} ${selected.size} integration${selected.size !== 1 ? 's' : ''}`,
        'success',
      );
      setBulkAction(null);
      setBulkTagValue('');
      setSelected(new Set());
      fetchIntegrations();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Bulk tag operation failed', 'error');
    }
  };

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
                  <div className={`h-px w-8 ${s < step ? 'bg-blue-600/50' : 'bg-gray-700'}`} />
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
                      setAuthMethod(t.authMethods[0] ?? '');
                      setCredentialValues({});
                      if (t.value === 'graph') {
                        setEndpoint('https://graph.microsoft.com/v1.0');
                      }
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
              <h3 className="text-lg font-medium text-white">
                {typeDef?.label ?? 'Integration'} — Configuration
              </h3>
              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase mb-1">Name</p>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={NAME_PLACEHOLDERS[selectedType] ?? 'e.g. my-integration'}
                    className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                {selectedType !== 'graph' &&
                  (selectedType === 'keeper' ? (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase mb-1">Region</p>
                      <select
                        value={endpoint}
                        onChange={(e) => setEndpoint(e.target.value)}
                        className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                      >
                        <option value="US">United States (default)</option>
                        <option value="EU">Europe</option>
                        <option value="AU">Australia</option>
                        <option value="GOV">US Government</option>
                        <option value="JP">Japan</option>
                        <option value="CA">Canada</option>
                      </select>
                      <p className="mt-0.5 text-xs text-gray-500">
                        Select the Keeper region where your vault is hosted
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase mb-1">
                        Endpoint URL
                      </p>
                      <input
                        type="url"
                        value={endpoint}
                        onChange={(e) => setEndpoint(e.target.value)}
                        placeholder={
                          ENDPOINT_PLACEHOLDERS[selectedType] ?? 'https://api.example.com'
                        }
                        className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                      />
                      {ENDPOINT_TOOLTIPS[selectedType] && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          {ENDPOINT_TOOLTIPS[selectedType]}
                        </p>
                      )}
                      <label className="mt-2 flex items-center gap-2 text-sm text-gray-400">
                        <input
                          type="checkbox"
                          checked={tlsSkipVerify}
                          onChange={(e) => setTlsSkipVerify(e.target.checked)}
                          className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
                        />
                        Allow self-signed TLS certificates
                      </label>
                    </div>
                  ))}
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase mb-1">
                    Headers{' '}
                    <span className="text-gray-600">(optional, one per line: Key: Value)</span>
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
              <h3 className="text-lg font-medium text-white">{typeDef.label} — Credentials</h3>
              {selectedType === 'graph' ? (
                <div className="mt-4">
                  {ssoStatus?.configured && ssoStatus?.enabled ? (
                    <div className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-4 text-sm text-emerald-300">
                      Uses Entra SSO App Registration — credentials are managed via SSO
                      configuration. No separate credentials needed.
                    </div>
                  ) : (
                    <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-300">
                      Entra SSO must be configured and enabled first. Go to Settings &rarr; SSO to
                      set up Entra ID.
                    </div>
                  )}
                </div>
              ) : (
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
                  {selectedType === 'keeper'
                    ? currentFields.map((field) => (
                        <div key={field.key}>
                          <p className="text-xs font-medium text-gray-500 uppercase mb-1">
                            {field.label}
                          </p>
                          <div className="relative">
                            <input
                              type={
                                field.sensitive && !visibleFields.has(field.key)
                                  ? 'password'
                                  : 'text'
                              }
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
                          {field.tooltip && (
                            <p className="mt-0.5 text-xs text-gray-500">{field.tooltip}</p>
                          )}
                        </div>
                      ))
                    : currentFields.map((field) => (
                        <KeeperFieldInput
                          key={field.key}
                          field={field}
                          value={credentialValues[field.key] ?? ''}
                          onChange={(val) => setCredential(field.key, val)}
                          keeperIntegrations={keeperIntegrations}
                          visibleFields={visibleFields}
                          toggleFieldVisibility={toggleFieldVisibility}
                        />
                      ))}
                </div>
              )}
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
              <h3 className="text-lg font-medium text-white">{typeDef.label} — Review</h3>
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
                  <dd className="mt-0.5 text-sm text-gray-300">
                    {selectedType === 'graph' ? 'Entra SSO' : AUTH_METHOD_LABELS[authMethod]}
                  </dd>
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

      {/* Search + bulk actions */}
      <div className="mt-4 flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search integrations..."
          className="w-64 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{selected.size} selected</span>
            <button
              type="button"
              onClick={() => {
                setBulkAction('add');
                setBulkTagValue('');
              }}
              className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
            >
              Add Tag
            </button>
            <button
              type="button"
              onClick={() => {
                setBulkAction('remove');
                setBulkTagValue('');
              }}
              className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
            >
              Remove Tag
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowCsvImport(true)}
          className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
        >
          Import CSV
        </button>
      </div>

      {/* Bulk tag input */}
      {bulkAction && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {bulkAction === 'add' ? 'Add' : 'Remove'} tag:
          </span>
          <input
            type="text"
            value={bulkTagValue}
            onChange={(e) => setBulkTagValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleBulkTag();
              if (e.key === 'Escape') setBulkAction(null);
            }}
            placeholder="tag name"
            autoFocus
            className="w-32 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleBulkTag}
            disabled={!bulkTagValue.trim()}
            className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {bulkAction === 'add' ? 'Add' : 'Remove'}
          </button>
          <button
            type="button"
            onClick={() => setBulkAction(null)}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Integrations table */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
                />
              </th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Tags</th>
              <th className="px-4 py-3">Last Tested</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  {search
                    ? 'No integrations match your search.'
                    : 'No integrations configured yet.'}
                </td>
              </tr>
            ) : (
              filtered.map((intg) => {
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
                    <td className="px-3 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={selected.has(intg.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelect(intg.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
                      />
                    </td>
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
                    <td className="px-4 py-3">
                      <TagInput
                        tags={intg.tags}
                        onAdd={(tag) => handleTagAdd(intg.id, tag)}
                        onRemove={(tag) => handleTagRemove(intg.id, tag)}
                      />
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

      {showCsvImport && (
        <CsvImportModal
          type="integration"
          onClose={() => setShowCsvImport(false)}
          onImported={fetchIntegrations}
        />
      )}
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
