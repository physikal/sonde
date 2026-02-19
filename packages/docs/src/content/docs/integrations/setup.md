---
title: Integration Packs Setup
---

Step-by-step configuration for each integration type. All integrations are configured from the dashboard: **Manage** > **Integrations** > **Add Integration**.

For general information about how integration packs work, see the [Integration Packs overview](/integrations/overview).

## TLS & Self-Signed Certificates

Many on-prem systems ship with self-signed TLS certificates (Proxmox VE, vCenter, Splunk, Nutanix Prism). See the [TLS & Certificates](/integrations/tls) page for detailed guidance on handling certificate verification.

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

## VMware vCenter

### Prerequisites

- vCenter Server accessible over HTTPS
- Read-only user account

### Configuration

| Field | Value |
|---|---|
| vCenter URL | `https://vcenter.company.com` |
| Username | `sonde@vsphere.local` |
| Password | (encrypted at rest) |
| Verify SSL | `true` or `false` |

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

## Observability Packs

### Datadog

| Field | Value |
|---|---|
| DD Site | `datadoghq.com` (or `us5.datadoghq.com`, etc.) |
| API Key | Datadog API key |
| Application Key | Datadog application key |

### Loki

| Field | Value |
|---|---|
| Loki URL | `https://loki.company.com:3100` |
| Auth | Bearer token, basic auth, or none |

### Splunk

| Field | Value |
|---|---|
| Splunk URL | `https://splunk.company.com:8089` |
| Token | Splunk auth token |

## ITSM Packs

### Jira

| Field | Value |
|---|---|
| Jira URL | `https://company.atlassian.net` |
| Email | Jira user email |
| API Token | Jira API token |

### PagerDuty

| Field | Value |
|---|---|
| API Key | PagerDuty API key (read-only) |

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
