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

- ServiceNow instance with API access
- OAuth app registration or Basic auth credentials
- User with read access to CMDB tables (cmdb_ci, cmdb_rel_ci, change_request, incident)

### Configuration

| Field | Value |
|---|---|
| Instance URL | `https://company.service-now.com` |
| Auth Method | `oauth` or `basic` |
| Client ID | (for OAuth) |
| Client Secret | (for OAuth) |
| Username/Password | (for Basic auth) |

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

### Prerequisites

- UniFi Network controller accessible over HTTPS from the hub (UDM, UDM-Pro, UDM-SE, or self-hosted controller)
- Local admin credentials (username and password)

### Configuration

| Field | Value |
|---|---|
| Controller URL | `https://192.168.1.1` (UDM) or `https://unifi.local:8443` (self-hosted) |
| Auth Method | `api_key` |
| Username | (controller admin user) |
| Password | (encrypted at rest) |
| Site | `default` (or your site name for multi-site deployments) |
| Controller Type | `udm` (UDM/UDM-Pro/UDM-SE) or `selfhosted` (Cloud Key / manual install) |
| Verify SSL | `false` (UniFi controllers use self-signed certs by default) |

The controller type determines the API paths used. UDM devices use `/proxy/network/api/s/{site}/` while self-hosted controllers use `/api/s/{site}/`. Authentication is session-based — Sonde logs in, caches the session cookie for 25 minutes, and automatically re-authenticates on expiry.

### Available Probes

- **site.health** — Overall site health summary (ISP, switches, APs, gateways)
- **devices** — List all network devices with status, model, firmware, uptime
- **device.detail** — Single device detail by MAC address
- **clients** — Active wireless and wired clients with hostname, IP, signal, experience score
- **events** — Recent network events (configurable limit)
- **alarms** — Active alarms and alerts
- **port.forwards** — Port forwarding rules

### Example Queries

- "What's the health of my UniFi network?"
- "List all access points and their firmware versions"
- "How many clients are connected right now?"
- "Show me any network alarms"
- "What port forwarding rules are configured?"

## UniFi Access

### Prerequisites

- UniFi Access system with API access enabled
- API token (generated in UniFi Access settings under Developer API)

### Configuration

| Field | Value |
|---|---|
| Access URL | `https://192.168.1.1/proxy/access/api/v1/developer` (through UDM) or `https://access-host:12445/api/v1/developer` (direct) |
| Auth Method | `api_key` |
| API Token | (bearer token from Access settings) |
| Verify SSL | `false` (self-signed certs typical) |

### Available Probes

- **doors** — List all doors with name, status, and lock state
- **door.logs** — Access event log for a specific door (requires door_id, configurable limit)
- **devices** — List access control devices (readers, hubs) with status and firmware

### Example Queries

- "List all doors in the access system"
- "Who were the last 10 people to access the server room?"
- "Are all door readers online?"
- "Show me the access log for the main entrance"

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
