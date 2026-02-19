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

### Creating Keys

1. **Manage** > **API Keys** > **Create Key**
2. Enter a descriptive name (e.g., "Claude Code - Josh", "n8n monitoring workflow")
3. Select role: **Member** (MCP only) or **Admin** (MCP + REST)
4. Optional: scope to specific agents (glob pattern) or probe types
5. The key value is shown once — copy it immediately

### Rotating Keys

Click **Rotate** on an existing key to generate a new value. The old value is immediately invalidated. Update all clients using this key.

### Best Practices

- Create separate keys for each client or integration
- Use the minimum role needed (member for MCP users, admin for automation)
- Scope keys to specific agents when possible (e.g., `prod-*` for production-only access)
- Rotate keys periodically and after any suspected compromise
- Name keys descriptively so you know what breaks if you revoke one

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

On each agent:

```bash
sonde packs update
```

If updated packs require new permissions, they enter pending state until approved.

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
| `SONDE_ADMIN_USER` | Yes | Bootstrap admin username |
| `SONDE_ADMIN_PASSWORD` | Yes | Bootstrap admin password |
| `SONDE_ENTRA_ENABLED` | No | `true` to enable Entra SSO |
| `SONDE_ENTRA_CLIENT_ID` | If SSO | Entra app client ID |
| `SONDE_ENTRA_TENANT_ID` | If SSO | Entra directory tenant ID |
| `SONDE_ENTRA_CLIENT_SECRET` | If SSO | Entra app client secret |
