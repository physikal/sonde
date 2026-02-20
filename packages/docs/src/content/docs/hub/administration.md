---
title: Administration Guide
---

Day-to-day operations for managing a Sonde deployment: user management, monitoring, updates, and maintenance.

## User Management

### Adding Users (SSO)

When Entra SSO is configured, add users before they try to log in:

1. Go to **Manage** > **Users**
2. Click **Add User**
3. Enter their email address and assign a role:
   - **Member** — MCP access only. They connect via Claude or API key for diagnostics.
   - **Admin** — MCP + dashboard. They manage agents, integrations, and users.
4. Save

The user can now log in via "Sign in with Microsoft". Their display name and Entra object ID are populated on first login.

### Group-Based Authorization

For larger teams, map an Entra security group:

1. Go to **Manage** > **Users** > **Authorized Groups** section
2. Click **Add Group**
3. Enter the Entra Group Object ID (from Azure Portal > Groups > select group > Object ID)
4. Enter a display name and default role
5. All group members are automatically authorized on SSO login

If a user matches both an individual entry and a group, the highest role wins.

### Disabling Users

Toggle the **Enabled** status on a user row. Disabled users are denied on next login attempt but their record is preserved. Re-enable to restore access.

### Removing Users

Delete a user record to revoke access completely. They'll be denied on next login. If they were auto-created from a group, they'll be re-created on next login unless the group is also removed.

## API Key Management

### Self-Service Keys (All Users)

All users (members, admins, owners) can manage their own API keys from **My Account** > **My API Keys** in the dashboard sidebar:

1. Click **Create Key**
2. Enter a descriptive name (e.g., "Claude Desktop", "Claude Code")
3. The key is always scoped to `member` role — no privilege escalation possible
4. Maximum 5 keys per user
5. The key value is shown once — copy it immediately

Users can **Rotate** (generate new value, invalidate old) or **Revoke** (permanently disable) their own keys. They cannot see or manage keys belonging to other users.

This is the primary way members get their MCP credentials — they log in to the dashboard, create a key, and use it to connect Claude Desktop or Claude Code.

### Admin Key Management

Admins manage all keys across the deployment from **Manage** > **API Keys**:

1. Click **Create Key**
2. Enter a descriptive name (e.g., "n8n monitoring workflow", "shared-team-key")
3. Select role: **Member** (MCP only) or **Admin** (MCP + REST)
4. Optional: scope to specific agents (exact names), probe types (glob patterns), or MCP clients (exact client IDs)
5. The key value is shown once — copy it immediately

### Rotating Keys

Click **Rotate** on an existing key to generate a new value. The old value is immediately invalidated. Update all clients using this key.

### Best Practices

- Direct members to **My API Keys** for self-service — avoid creating keys on their behalf
- Create separate keys for each client or integration
- Use the minimum role needed (member for MCP users, admin for automation)
- Scope keys to specific agents when possible (e.g., `prod-server-1, staging-web`)
- Restrict clients to known MCP consumers (e.g., `claude-desktop, cursor`)
- Rotate keys periodically and after any suspected compromise
- Name keys descriptively so you know what breaks if you revoke one

## Tag Management

Tags are free-form labels for organizing agents and integrations. They enable filtered queries via MCP and bulk operations in the dashboard.

### Assigning Tags

**Single entity:** Open the agent or integration detail view and add tags inline.

**Bulk:** In the Fleet or Integrations view, select multiple rows with checkboxes and use the bulk tag actions bar to add or remove tags.

**REST API:**

```bash
# Set tags on an agent
curl -X PUT https://your-hub/api/v1/agents/AGENT_ID/tags \
  -H "Authorization: Bearer admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"tags": ["prod", "database", "us-east"]}'

# Bulk add tags to multiple agents
curl -X PATCH https://your-hub/api/v1/agents/tags \
  -H "Authorization: Bearer admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"add": ["prod"], "ids": ["agent-id-1", "agent-id-2"]}'
```

### Using Tags with AI Clients

MCP users filter by tags using `#tagname` syntax in their prompts:

- *"Show me #prod agents"* — filters to agents tagged `prod`
- *"Run diagnostics on #database #linux"* — filters to agents with both tags (AND logic)

The `#` prefix is required. Without it, words are treated as natural language and no tag filtering occurs. This prevents accidental narrowing — "check my linux servers" queries all agents, not just those tagged `linux`.

### Global Tag Operations

From the dashboard at **Manage** > **Tags**:

- **Rename** — Changes a tag across all agents and integrations
- **Delete** — Removes a tag from all entities
- **Import** — Bulk import tags from CSV

### Best Practices

- Use consistent naming: lowercase, hyphenated (e.g., `us-east`, `prod-db`)
- Keep tag count manageable — a few well-chosen tags are more useful than dozens
- Use tags for cross-cutting concerns (environment, location, team) — use access groups for security boundaries

## Fleet Management

### Monitoring Agent Health

The **Fleet** page shows all agents with real-time status:

- **Online** (green) — Connected and responding
- **Offline** (gray) — Not connected. Check if the service is running.
- **Degraded** (yellow) — Connected but with issues (e.g., failed packs)

Click any agent to see detailed health, pack status, and recent probe history.

### Enrolling New Agents

1. Generate token: **Manage** > **Enrollment** > **Generate Token**
2. The page shows the full install command with token
3. SSH to target machine, paste the command
4. Agent appears in fleet within seconds

### Removing Agents

From the agent detail view, click **Remove Agent**. This:

- Revokes the agent's mTLS certificate
- Removes it from the fleet view
- The agent will fail to reconnect

To re-add the machine, go through the enrollment process again.

## Integration Management

### Adding Integrations

1. **Manage** > **Integrations** > **Add Integration**
2. Select the type (Proxmox, ServiceNow, Citrix, etc.)
3. Enter endpoint URL and credentials
4. Click **Test Connection** to verify
5. Save

Credentials are encrypted at rest using AES-256-GCM. For per-type setup instructions, see the [Integration Packs Setup](/integrations/setup) guide.

### Monitoring Integration Health

Each integration shows its status:

- **Connected** — Last test succeeded
- **Error** — Last test failed (click for details)
- **Untested** — Never tested

Periodically test connections, especially after credential rotations.

## MCP Instructions

The hub sends structured instructions to AI clients during the MCP handshake. These guide the AI's diagnostic workflow — telling it to discover probes via `list_capabilities` before running them, explaining probe naming conventions, and listing active integrations.

### How It Works

Instructions are assembled from three parts:

1. **Custom prefix** (optional) — Organization-specific guidance set by the owner
2. **Core instructions** (always present) — Sonde workflow guidance, probe naming rules, tool usage order
3. **Active integrations** (dynamic) — One line per configured integration with its type and description

Instructions are built per-session. When you add or remove an integration, new MCP connections automatically reflect the change. No client-side reconfiguration needed.

### Editing the Custom Prefix

1. Go to **Settings** > **MCP Prompt** (owner only)
2. Enter your custom text in the prefix field (up to 2000 characters)
3. Review the full instructions preview below
4. Click **Save**

Example prefix:

```
You are assisting the ACME Corp infrastructure team. Our critical
systems are tagged #prod. Always check #prod agents first when
asked about outages.
```

### REST API

```bash
# Get current instructions
curl https://your-hub/api/v1/settings/mcp-instructions \
  -H "Authorization: Bearer owner-api-key"

# Update custom prefix
curl -X PUT https://your-hub/api/v1/settings/mcp-instructions \
  -H "Authorization: Bearer owner-api-key" \
  -H "Content-Type: application/json" \
  -d '{"customPrefix": "Your org-specific guidance here."}'
```

Both endpoints require the `owner` role.

## AI Analysis

The hub can connect to the Claude API for automated analysis of probe trending data. During an outage, admins click **Activate AI** on the Trending page to get an AI-generated diagnosis of failure patterns.

### Configuring the API Key

1. Go to **Settings** > **AI Analysis** (owner only)
2. Enter your Anthropic API key (from [console.anthropic.com](https://console.anthropic.com))
3. Select a model (Claude Sonnet 4 is the default)
4. Click **Save**
5. Click **Test Connection** to verify the key works

The API key is encrypted at rest using `SONDE_SECRET` (AES-256-GCM). The GET endpoint never returns the raw key — only whether one is configured.

### Using AI Analysis

Once configured, all admins see the **Activate AI** button on the **Diagnostics** > **Trending** page:

1. Select a time window (1h, 6h, 12h, or 24h)
2. Click **Activate AI**
3. The analysis streams back in real-time with:
   - Overall assessment
   - Key failure patterns with likely causes
   - Recommended Sonde commands to run next

### Shared Analysis

The hub maintains a singleton analysis — if one admin triggers it, others arriving at the Trending page see the same stream (or the completed result). This prevents duplicate API calls. Results are cached for 5 minutes.

### REST API

```bash
# Check AI config (owner)
curl https://your-hub/api/v1/settings/ai \
  -H "Authorization: Bearer owner-api-key"

# Update AI config (owner)
curl -X PUT https://your-hub/api/v1/settings/ai \
  -H "Authorization: Bearer owner-api-key" \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "sk-ant-...", "model": "claude-sonnet-4-20250514"}'

# Test connection (owner)
curl -X POST https://your-hub/api/v1/settings/ai/test \
  -H "Authorization: Bearer owner-api-key"

# Trigger analysis (admin)
curl -X POST "https://your-hub/api/v1/trending/analyze?hours=24" \
  -H "Authorization: Bearer admin-api-key"
```

## Audit Log

The audit log records every action with tamper-evident integrity:

- Every probe execution (who requested it, which agent, result)
- API key creation and revocation
- Agent enrollment and removal
- Integration configuration changes
- Login events

Access at **Diagnostics** > **Audit**. Filter by agent, tool, API key, or date range.

The hash chain integrity indicator shows whether the log has been tampered with.

## Backup and Recovery

### What to Back Up

1. **Database file** — At the path set by `SONDE_DB_PATH` (default `/data/sonde.db`)
2. **SONDE_SECRET** — The encryption key for credentials at rest
3. **Environment variables** — All `SONDE_*` env vars

### Recovery Process

1. Deploy a fresh hub with the same `SONDE_SECRET`
2. Restore the database file to the configured path
3. Start the hub — it runs migrations if needed
4. Agents will reconnect automatically (mTLS certs are stored on the agent side)
5. Verify integrations and SSO configuration

If `SONDE_SECRET` is lost, encrypted credentials become unrecoverable. Re-enter all integration credentials and Entra client secret.

## Updating

### Hub Updates

**Dokploy:** Push to your configured branch triggers auto-redeploy.

**Docker Compose:**

```bash
docker compose pull && docker compose up -d
```

The hub runs database migrations automatically on startup. No manual steps needed.

### Agent Updates

The dashboard flags outdated agents. Agents can self-update:

```bash
sonde update
```

This downloads the latest version, verifies the signature, and restarts the service.

### Pack Updates

Packs are bundled with the agent package. Updating the agent (`sonde update` or `npm install -g @sonde/agent@latest`) includes the latest pack versions. After updating, restart the agent service.

## Scaling Considerations

- The hub handles hundreds of agents on modest hardware (SQLite is the bottleneck for very large deployments)
- Each agent maintains one persistent WebSocket connection to the hub
- Integration packs share the hub's HTTP connection pool
- The dashboard uses WebSocket for real-time updates, which scales with concurrent admin sessions

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `SONDE_SECRET` | Yes | Root encryption key. Never rotate without re-entering all credentials. |
| `SONDE_DB_PATH` | Recommended | Database file path. Default: `./sonde.db` |
| `SONDE_ADMIN_USER` | Recommended | Bootstrap admin username (required for dashboard login) |
| `SONDE_ADMIN_PASSWORD` | Recommended | Bootstrap admin password (required for dashboard login) |
| `SONDE_HUB_URL` | Recommended | Public URL for SSO callbacks and agent enrollment |

Entra SSO is configured through the dashboard (**Settings** > **SSO**), not environment variables. Credentials are encrypted at rest in the database.
