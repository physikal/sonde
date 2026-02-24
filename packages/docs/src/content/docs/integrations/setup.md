---
title: Integration Packs Setup
---

Step-by-step configuration for each integration type. All integrations are configured from the dashboard: **Manage** > **Integrations** > **Add Integration**.

For general information about how integration packs work, see the [Integration Packs overview](/integrations/overview).

## TLS & Self-Signed Certificates

Many on-prem systems ship with self-signed TLS certificates (Proxmox VE, Splunk, Nutanix Prism). See the [TLS & Certificates](/integrations/tls) page for detailed guidance on handling certificate verification.

**Quick fix:** When adding or editing an integration, check **Skip TLS certificate verification** to accept any certificate from that specific integration. Other integrations and agent connections are unaffected.

## Proxmox VE

### Prerequisites

- Proxmox VE cluster accessible over HTTPS from the hub server
- API token with audit-only privileges

### Create API Token (Least Privilege)

SSH into any PVE node and run these commands to create a read-only monitoring token:

```bash
# Create a read-only monitoring role
pveum role add SondeMonitor -privs \
  "VM.Audit,Sys.Audit,Datastore.Audit,SDN.Audit,Pool.Audit,Sys.Syslog"

# Create user and API token
pveum user add sonde@pve
pveum user token add sonde@pve sonde-token
# SAVE the token secret — it won't be shown again!

# Assign role to BOTH user AND token
pveum acl modify / -user sonde@pve \
  -role SondeMonitor -propagate 1
pveum acl modify / -token 'sonde@pve!sonde-token' \
  -role SondeMonitor -propagate 1
```

Both the user and token need ACLs assigned — assigning only to the token is not sufficient. These privileges are strictly read-only: no power management, no config changes, no deletions.

### Configuration in Dashboard

| Field | Value |
|---|---|
| PVE URL | `https://pve01.local:8006` (your PVE node/VIP) |
| Token ID | `sonde@pve!sonde-token` |
| Token Secret | (the secret from token creation) |
| Verify SSL | `false` (common for self-signed PVE certs) |

Multiple PVE clusters can be configured as separate integrations.

### Available Runbooks

**proxmox-vm-health** — Ask: *"Check the health of VM 302"*
Runs cluster status, HA status, VM status, VM config, storage checks, recent tasks, and LVM verification.

**proxmox-cluster-health** — Ask: *"How's my Proxmox cluster doing?"*
Fleet-wide overview of node health, resource usage, HA status, storage capacity, and recent failures.

**proxmox-storage-audit** — Ask: *"Which VMs have local-only disks that would break HA?"*
Identifies VMs with local storage that are HA-managed, recommending migration commands.

## ServiceNow CMDB

### Prerequisites

- ServiceNow instance with REST API access
- **Basic auth:** User account with `snc_read_only` and `itil` roles
- **OAuth 2.0:** OAuth application registered in ServiceNow (System OAuth > Application Registry) with `client_credentials` grant enabled. Requires Washington DC release or newer with the OAuth 2.0 plugin and `glide.oauth.inbound.client.credential.grant_type.enabled` set to `true`.

### Configuration (Basic Auth)

| Field | Value |
|---|---|
| Instance URL | `https://company.service-now.com` |
| Auth Method | `api_key` (Basic auth) |
| Username | ServiceNow user with `snc_read_only` + `itil` roles |
| Password | (encrypted at rest) |

### Configuration (OAuth 2.0)

| Field | Value |
|---|---|
| Instance URL | `https://company.service-now.com` |
| Auth Method | `oauth2` |
| Client ID | OAuth application client ID (from Application Registry) |
| Client Secret | (encrypted at rest) |

OAuth 2.0 uses the `client_credentials` grant type. Sonde exchanges the client ID and secret for a bearer token via `POST /oauth_token.do` and caches it until expiry. No username or password needed — the OAuth application user's roles determine API access. Assign `snc_platform_rest_api_access` and `snc_read_only` roles to the application user.

### Available Probes

- **ci.lookup** — Look up a configuration item by name or IP address
- **ci.owner** — Get ownership and support group information for a CI
- **ci.relationships** — Get upstream and downstream CI relationships
- **ci.lifecycle** — Get lifecycle and asset information (install date, warranty, EOL)
- **changes.recent** — Recent change requests associated with a CI (configurable lookback)
- **incidents.open** — Open incidents associated with a CI
- **service.health** — Business service overview with child CIs

### Example Queries

- "Who owns server prod-web01?"
- "Show me recent changes to the database servers"
- "Are there open incidents for the mail server?"
- "What's the lifecycle status of these CIs?"

## Citrix

### Prerequisites

- Citrix Director/Monitor API access (on-prem or Cloud)
- Citrix OData feed access
- (Optional) Citrix ADC/NetScaler NITRO API access

### Configuration

| Field | Value |
|---|---|
| Director URL | `https://director.company.com` |
| Customer ID | (Citrix Cloud only) |
| Client ID/Secret | (Citrix Cloud API credentials) |
| Domain/Username/Password | (on-prem auth) |

### Example Queries

- "Investigate StoreFront issues"
- "Show me connection failure rates"
- "What's the logon performance trend?"
- "Which VDA machines are unregistered?"

The Citrix diagnostic runbook can correlate data across Director, OData, ADC, and agent-level StoreFront checks simultaneously.

## Microsoft Graph + Intune

### Prerequisites

- Entra app registration (reuses the same one from SSO setup)
- Additional application-level API permissions granted

### Additional Permissions Needed

In your existing Entra app registration, add these **Application** permissions (not Delegated):

- `User.Read.All`
- `Group.Read.All`
- `AuditLog.Read.All`
- `DeviceManagementManagedDevices.Read.All`
- `DeviceManagementConfiguration.Read.All`
- `DeviceManagementApps.Read.All`

Grant admin consent for all.

### Configuration

The Graph pack detects the existing Entra SSO configuration automatically. No additional endpoint configuration needed — it reuses the client ID and secret, but with client_credentials flow instead of authorization code flow.

## Microsoft Graph + Intune — Example Queries

- "Look up user john.doe@company.com in Entra"
- "What groups is this user a member of?"
- "Show me recent sign-in failures"
- "Which Intune-managed devices are non-compliant?"
- "What device compliance policies are configured?"
- "Show me managed apps on mobile devices"

## Nutanix

### Prerequisites

- Nutanix Prism Central accessible over HTTPS from the hub
- Local user account with Viewer role (least privilege)

### Configuration

| Field | Value |
|---|---|
| Prism Central URL | `https://prism-central.company.com:9440` |
| Username | (viewer-role account) |
| Password | (encrypted at rest) |
| Verify SSL | `true` or `false` |

### Available Runbooks

- **nutanix-cluster-health** — Fleet overview across all registered clusters
- **nutanix-vm-health** — Single VM deep dive with storage, network, protection status
- **nutanix-capacity-planning** — Headroom analysis for CPU, memory, and storage

### Example Queries

- "How's my Nutanix cluster doing?"
- "Check the health of VM web-prod-01"
- "Do I have enough capacity for 10 more VMs?"
- "Which VMs are not protected by snapshots?"

## Splunk

### Prerequisites

- Splunk Enterprise accessible over HTTPS from the hub
- Authentication token or Basic auth credentials

### Configuration

| Field | Value |
|---|---|
| Splunk URL | `https://splunk.company.com:8089` |
| Auth Method | `bearer` or `basic` |
| Token | Splunk auth token (for bearer) |
| Username/Password | (for basic auth) |

### Available Probes

- **search** — Run SPL queries and return results
- **indexes** — List all indexes with size and event count
- **saved_searches** — List saved searches with schedule info
- **health** — Splunkd health status with per-feature breakdown

### Example Queries

- "Is Splunk healthy?"
- "What indexes are available and how large are they?"
- "Search Splunk for errors in the last hour: index=main level=ERROR"
- "Show me saved searches in Splunk"

## vCenter

### Prerequisites

- VMware vCenter Server accessible over HTTPS from the hub
- User account with read-only privileges (or a dedicated read-only role)

### Configuration

| Field | Value |
|---|---|
| vCenter URL | `https://vcenter.company.com` |
| Auth Method | `api_key` (uses session-based auth internally) |
| Username | `sonde@vsphere.local` (read-only account) |
| Password | (encrypted at rest) |

Session tokens are acquired automatically via `POST /api/session` and cached for 5 minutes.

### Example Queries

- "List all VMs in vCenter"
- "Show me the ESXi hosts"
- "What datastores are available?"
- "Check vCenter health"

## Datadog

### Prerequisites

- Datadog account with API access
- API key and Application key (generate from Organization Settings > API Keys / Application Keys)

### Configuration

| Field | Value |
|---|---|
| Datadog API URL | `https://api.datadoghq.com` (US1) or `https://api.datadoghq.eu` (EU) |
| Auth Method | `api_key` |
| API Key | (your Datadog API key) |
| Application Key | (your Datadog application key) |

The application key determines the scope of data access. Use a key scoped to a service account for least-privilege.

### Example Queries

- "Show me triggered Datadog monitors"
- "List infrastructure hosts in Datadog"
- "What events happened in the last 4 hours?"

## ThousandEyes

### Prerequisites

- ThousandEyes account with API access
- API bearer token (generate from Account Settings > Users and Roles > Profile > User API Tokens)

Token generation requires MFA to be enabled on your account.

### Configuration

| Field | Value |
|---|---|
| ThousandEyes API URL | `https://api.thousandeyes.com` |
| Auth Method | `bearer_token` |
| Token | (API bearer token) |

The API URL is the same for all accounts. Tokens inherit the permissions of the associated user — use a user with a read-only role for least privilege.

### Available Probes

- **alerts.active** — Active alerts with severity, state, and violation count
- **tests.list** — Configured tests with type, interval, and assigned agents
- **network.metrics** — Per-agent latency, loss, and jitter for a specific test
- **network.path-vis** — Hop-by-hop path visualization for a specific test
- **agents.list** — ThousandEyes agents with type, location, and status
- **outages.network** — Detected internet outages affecting your tests

### Example Queries

- "Show me active ThousandEyes alerts"
- "List all ThousandEyes tests"
- "What's the network latency for test 12345?"
- "Show me the path visualization for test 12345"
- "Are there any internet outages affecting my tests?"
- "List ThousandEyes agents and their locations"

## Loki

### Prerequisites

- Grafana Loki instance accessible over HTTP/HTTPS from the hub
- Authentication credentials (Basic auth for Grafana Cloud, Bearer token, or none for local instances)

### Configuration

| Field | Value |
|---|---|
| Loki URL | `https://logs-prod.grafana.net` (Grafana Cloud) or `http://loki.local:3100` |
| Auth Method | `api_key` (Basic) or `bearer_token` |
| Username | Grafana Cloud instance ID (for Basic) |
| Password / Token | Grafana Cloud API key or service token |

For multi-tenant Loki, set the `X-Scope-OrgID` header via the integration's custom headers field.

### Example Queries

- "Query Loki for errors in the last hour: {job=\"varlogs\"} |= \"error\""
- "What labels are available in Loki?"
- "Show me series matching {namespace=\"production\"}"

## Jira

### Prerequisites

- Atlassian Jira Cloud instance
- Email address and API token (generate from [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens))

### Configuration

| Field | Value |
|---|---|
| Jira URL | `https://your-domain.atlassian.net` |
| Auth Method | `api_key` |
| Email | (your Atlassian email) |
| API Token | (generated API token) |

The API token inherits the permissions of the associated user account. Use a service account with read-only project access for least privilege.

### Example Queries

- "Search Jira for open bugs: project = PROJ AND type = Bug AND status = Open"
- "Show me the details of PROJ-123"
- "What projects are in Jira?"
- "Show change history for INC-456"

## PagerDuty

### Prerequisites

- PagerDuty account with API access
- REST API key (generate from Integrations > API Access Keys with read-only scope)

### Configuration

| Field | Value |
|---|---|
| PagerDuty API URL | `https://api.pagerduty.com` |
| Auth Method | `bearer_token` |
| Token | (REST API key) |

Use a read-only API key. Full-access keys are not needed since Sonde only performs read operations.

### Example Queries

- "Show me active PagerDuty incidents"
- "List PagerDuty services"
- "Who is on call right now?"
- "Show details for service P1234ABC"

## UniFi Network

Uses the official UniFi Network API (requires Network Application 9.0.108 or newer).

### Prerequisites

- UniFi OS device (UDM, UDM-Pro, UDM-SE, UCG-Ultra) accessible over HTTPS from the hub
- API key generated in the Network application

### Generate API Key

1. Log into your UniFi controller's local portal
2. Go to **Network > Settings > Control Plane > Integrations**
3. Click **Create API Key**, give it a name, set expiration (or "Never Expires")
4. Copy the key — it's only shown once

The API key is read-only. No username or password needed.

### Configuration

| Field | Value |
|---|---|
| Controller URL | `https://192.168.1.1` (your UDM IP) |
| Auth Method | `api_key` |
| API Key | (the key from step above) |
| Verify SSL | `false` (UniFi controllers use self-signed certs by default) |

### Available Probes

- **info** — Application version and basic metadata
- **sites** — List all sites on this controller
- **devices** — Adopted devices with state, model, firmware, features
- **device.detail** — Full device details including interfaces and uplink (by UUID)
- **device.stats** — Latest device statistics: CPU, memory, uptime, load averages (by UUID)
- **clients** — Connected clients with type, IP, connection time
- **networks** — Configured networks (VLANs, etc.)
- **wans** — WAN interface definitions

### Example Queries

- "What version is my UniFi controller running?"
- "List all network devices and their firmware"
- "How many clients are connected?"
- "Show me the CPU and memory usage of device X"
- "What networks are configured?"

## UniFi Access

### Prerequisites

- UniFi Access system with the Developer API enabled
- API token (bearer token)

### Generate API Token

1. Open the UniFi Access application on your console
2. Go to **Settings > Developer API**
3. Enable the API and generate a token
4. Copy the token — it's only shown once

### Configuration

| Field | Value |
|---|---|
| Access URL | `https://192.168.1.1/proxy/access/api/v1/developer/` (through UDM) or `https://access-host:12445/api/v1/developer/` (direct) |
| Auth Method | `api_key` |
| API Token | (the bearer token from step above) |
| Verify SSL | `false` (self-signed certs typical) |

### Available Probes

- **doors** — List all doors with name, status, and lock state
- **logs** — Access event log (door unlocks, denied attempts). Filterable by topic.
- **devices** — Access control devices (readers, hubs) with status and firmware

### Example Queries

- "List all doors in the access system"
- "Show me recent access logs"
- "Who accessed the server room recently?"
- "Are all door readers online?"

## Keeper Secrets Manager

### Prerequisites

- Keeper Secrets Manager application created in the Keeper admin console
- One-time access token generated for device binding

### Generate a One-Time Access Token

1. Log into the Keeper admin console
2. Navigate to **Secrets Manager** > **Applications**
3. Create an application (or select an existing one) and assign the shared folders it can access
4. Click **Devices** > **Add Device** and generate a one-time access token
5. Copy the token — it can only be used once

### Configuration in Dashboard

Navigate to **Manage** > **Integrations** > **Add Integration** and select **Keeper**.

| Field | Value |
|---|---|
| One-Time Token | (the token from the admin console) |
| Region | US, EU, AU, GOV, JP, or CA |

During creation, the hub uses the one-time token to establish a device binding with Keeper. The token is consumed immediately and the resulting device configuration is encrypted and stored in the database.

### Credential Resolver

Keeper can act as a credential resolver for other integrations. When configuring an integration's credentials, you can reference a Keeper record using a `keeper://` URI instead of entering secrets directly. The hub resolves the URI at runtime by fetching the value from the Keeper vault.

### Available Probes

- **list-records** — List accessible record UIDs and titles from the vault

### Example Queries

- "List records in the Keeper vault"
- "What secrets are available in Keeper?"

## Testing Integrations

After configuring any integration:

1. Click **Test Connection** in the integration detail view
2. If successful, the status changes to "Connected"
3. Use the **Try It** panel in the dashboard to run a probe manually
4. Or ask Claude: *"Test the ServiceNow connection"* or *"List Proxmox nodes"*

If the test fails, check:

- Network connectivity from the hub to the external service
- Credentials are correct and not expired
- Required permissions are granted
- SSL/TLS settings match the target (self-signed certs may need verification disabled)
