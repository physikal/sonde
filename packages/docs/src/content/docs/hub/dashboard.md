---
title: Dashboard Guide
---

The Sonde Dashboard is a web-based management interface served by the hub. It provides fleet visibility, enrollment management, integration configuration, and user administration.

## Accessing the Dashboard

Navigate to `https://your-hub/dashboard` in your browser.

**Login options:**

- **Local admin** — Username and password set via `SONDE_ADMIN_USER` / `SONDE_ADMIN_PASSWORD` env vars
- **Entra SSO** — "Sign in with Microsoft" button (if configured)

Sessions last 8 hours with a sliding window (refreshes on activity).

## Fleet

### Overview

The main view showing all enrolled agents in a table:

- **Name** — Agent hostname/identifier
- **Status** — Online (green), Offline (gray), Degraded (yellow)
- **Tags** — Assigned tags for organizing and filtering agents
- **Packs** — Installed packs (Docker, systemd, system, etc.)
- **Last Seen** — Time since last heartbeat
- **Version** — Agent software version
- **OS** — Operating system

Status updates in real-time via WebSocket. Click any agent row to see its detail view. Use the search bar to filter by name, tags, status, packs, or OS. Select multiple agents with checkboxes for bulk tag operations.

### Tags

Tags are free-form labels you assign to agents and integrations for organization and filtering. Examples: `prod`, `database`, `citrix-farm`, `us-east`.

**Assigning tags in the dashboard:**

- Single agent/integration: open its detail view and add tags inline
- Bulk: select multiple rows with checkboxes, then use the bulk tag actions bar

**Using tags with AI clients:**

When talking to Claude (or any MCP client), use `#tagname` syntax to filter by tags:

- *"Show me #prod agents"* — filters to agents tagged `prod`
- *"Run a health check on #database #linux"* — filters to agents with both tags

The `#` prefix is required. Without it, Claude treats words as natural language and does not apply tag filtering. This prevents accidental narrowing of results — saying "check my linux servers" queries all agents, not just those tagged `linux`.

Tag filtering uses AND logic: specifying multiple tags returns only agents/integrations matching all of them.

**Managing tags globally:**

Admins can manage all tags from **Manage** > **Tags**:

- View all tags with agent/integration counts
- Rename a tag across all entities
- Delete unused tags
- Import tags in bulk (CSV)

### Agent Detail

Drilling into an agent shows:

- Agent info card (name, ID, OS, version, uptime)
- Installed packs with status (active, pending permissions)
- Recent probe history (last 50 probes with results and durations)
- Agent-specific audit log
- Health metrics

### Audit

Searchable, filterable audit log of all probe executions:

- Filter by agent, tool, API key, date range
- Shows who requested what, which agent served it, the result, and duration
- Hash chain integrity indicator (tamper-evident)

## Manage

### Enrollment

Generate enrollment tokens for new agents.

- Click **Generate Token** to create a single-use token (15-minute expiry)
- The page shows the full install command with the token embedded
- Live feed: agents appear in real-time as they enroll
- Previously used/expired tokens are shown with their status

### API Keys

Create and manage API keys for MCP clients, automation scripts, and integrations.

- **Create Key**: Name, Role (member/admin), optional agent scope, optional probe scope
- Keys are shown once on creation — copy immediately
- **Rotate**: Generate a new key value, invalidating the old one
- **Revoke**: Permanently disable a key
- Each key shows: name, created date, last used, role, scopes

### Integrations

Configure hub-side integration packs that call external REST APIs.

- Cards showing each configured integration with status (connected/error/untested)
- **Add Integration**: Select type (ServiceNow, Citrix, Proxmox, etc.) > enter endpoint URL and credentials > test connection
- Credential fields are masked by default with show/hide toggles
- **Test Connection** button validates connectivity before saving
- Edit or delete existing integrations
- Use search and bulk tagging to organize integrations (see [Tags](#tags) above)

See the [Integration Packs Setup](/integrations/setup) guide for per-type configuration details.

### Users

Manage who can access Sonde (requires Entra SSO to be configured).

**Individual Users section:**

- Add users by email address — they don't need to have logged in yet
- Assign role: member (MCP only) or admin (MCP + dashboard)
- View login history, enable/disable users
- Users auto-created from group auth show their source

**Authorized Groups section:**

- Map Entra security groups to default Sonde roles
- All members of the group are automatically authorized on SSO login
- Enter the Entra Group Object ID (from Azure Portal) and a display name

### Access Groups

Optional scoping to restrict users to specific agents or integrations.

- By default, all authorized users can query everything — access groups are opt-in
- Create an access group (e.g., "Citrix Team")
- Assign agent patterns (e.g., `citrix-*`), integrations, and users
- Users in the group only see their assigned agents/integrations via MCP

## Diagnostics

### Try It Panel

A built-in diagnostic testing interface:

1. Select an agent from the dropdown
2. Select a diagnostic category (docker, system, systemd, etc.)
3. See which probes would fire
4. Click **Execute** to run them for real
5. View the structured results

Useful for testing probe functionality without needing an AI client connected.

### Policies

Configure per-API-key access policies: restrict to specific agents (glob patterns) and tools.

## Settings (Owner Only)

### SSO Configuration

Configure Entra ID single sign-on.

- Enter Tenant ID, Client ID, Client Secret
- Redirect URI is auto-populated from the hub URL
- **Test Connection** validates the OIDC discovery endpoint
- Help text explains the Azure Portal setup steps
- SSO is additive — the local admin login always remains available

See [Security & Authentication](/reference/security) for the full Entra SSO setup guide.

## Role-Based Access

| Feature | Member | Admin | Owner |
|---|---|---|---|
| MCP tools (probe, diagnose, etc.) | Yes | Yes | Yes |
| Dashboard access | No | Yes | Yes |
| Fleet view, agent details | No | Yes | Yes |
| Enrollment, API keys | No | Yes | Yes |
| Integration management | No | Yes | Yes |
| User management | No | Yes | Yes |
| SSO configuration | No | No | Yes |

**Members** are MCP-only users. They connect through Claude or API keys and have full diagnostic capability, but cannot access the dashboard. If they try to log in, they see a message directing them to connect via Claude Desktop or Claude Code.

## Real-Time Updates

The dashboard uses WebSocket connections to the hub for live updates:

- Agent status changes (online/offline) appear instantly
- New agent enrollments appear in the fleet view in real-time
- Probe activity shows in the agent detail view as it happens
- Toast notifications appear for key events
