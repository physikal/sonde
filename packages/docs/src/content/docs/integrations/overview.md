---
title: Integration Packs
---

Integration packs run on the hub and connect to external REST APIs — no agent required on the remote system. There are currently 19 integration packs covering hypervisors, ITSM, observability, networking, security, and secrets management.

## How they work

Agent packs run commands on a target machine via the Sonde agent. Integration packs are different: the hub calls the external API directly using stored credentials. This means you only need network connectivity from the hub to the target API endpoint.

```
AI Client  →  Hub  →  External API (Proxmox, ServiceNow, etc.)
                ↘  Agent  →  Local commands (system, docker, etc.)
```

## Adding an integration

1. Open the dashboard and navigate to **Manage** > **Integrations**
2. Click **Add Integration**
3. Select the integration type, name it, and enter the endpoint URL
4. Choose an auth method and fill in credentials
5. If the target uses a self-signed certificate, check **Skip TLS certificate verification** (see [TLS & Certificates](/integrations/tls))
6. Click **Create**
7. On the integration detail page, click **Test Connection** to verify

## Editing an integration

From the integration detail page, click **Edit** on either the Configuration or Credentials section. Configuration changes (endpoint, headers, TLS settings) and credential changes are saved independently. The Activity Log at the bottom tracks all changes and test attempts.

## Available probes

Each integration type exposes probes prefixed with its pack name. For example, a Proxmox integration exposes probes like `proxmox.nodes.list`, `proxmox.vm.status`, etc.

You can run probes via the MCP `probe` tool or through diagnostic runbooks via the `diagnose` tool. Integration probes don't require an `agent` parameter — the hub handles them directly.

## Supported types

| Type | Auth Methods | Use Case |
|---|---|---|
| Proxmox VE | API Token | Hypervisor fleet monitoring |
| ServiceNow | Basic / OAuth 2.0 (client credentials) | CMDB lookups, incident correlation |
| Citrix | Basic / OAuth | VDA health, session diagnostics |
| Microsoft Graph | Auto (from SSO) | Entra/Intune device and user data |
| Splunk | Token / Basic | Log search, saved search results |
| Nutanix | Basic / Token | Prism Central cluster and VM monitoring |
| vCenter | Basic (session) | VMware VM, host, datastore, and cluster monitoring |
| Datadog | API Key + App Key | Monitor status, hosts, events |
| Loki | Basic / Bearer | LogQL queries, label discovery |
| Jira | Basic (email + API token) | Issue search, project listing, change history |
| PagerDuty | Token | Incidents, services, on-call schedules |
| UniFi Network | API Key (`X-API-KEY`) | Devices, clients, networks, WAN, device stats |
| UniFi Access | Bearer Token | Door status, access logs, reader/hub devices |
| ThousandEyes | Bearer Token | Network path analysis, latency, outage detection |
| Cisco Meraki | API Key | Device fleet status, switch ports, network topology |
| Check Point | Session (login) | Gateways, access rules, host/network objects |
| A10 Thunder | Session (login) | Virtual servers, service groups, real server health |
| Keeper | One-Time Token | Secrets Manager vault access, credential resolver |

For per-type setup instructions (required permissions, credential format, example queries), see the [Integration Packs Setup](/integrations/setup) page.
