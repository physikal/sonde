---
title: Troubleshooting
---

Common issues and their solutions when deploying and using Sonde.

## Hub Issues

### Hub won't start

**"SONDE_SECRET is required"** — Set the `SONDE_SECRET` environment variable. Generate one with `openssl rand -hex 32`.

**Can't log into the dashboard** — Set both `SONDE_ADMIN_USER` and `SONDE_ADMIN_PASSWORD` environment variables. The hub starts without them, but dashboard login requires either these credentials or Entra SSO.

**Port 3000 already in use** — Another service is using the port. Change the port mapping in docker-compose.yml or stop the conflicting service.

**Database migration errors** — If the database is corrupted, stop the hub, back up the database file, delete it, and restart. The hub creates a fresh database on startup. You'll need to re-enroll agents and reconfigure integrations.

### Dashboard not loading

**Blank page at /dashboard** — Check the browser console for errors. Ensure the hub container built successfully with the dashboard assets bundled. Try a hard refresh (Ctrl+Shift+R).

**Login redirects in a loop** — Clear browser cookies for the hub domain. If using SSO, verify the redirect URI in Entra matches your hub URL exactly.

**"502 Bad Gateway"** — The hub container may not be running. Check `docker compose logs sonde-hub`. Ensure your reverse proxy is forwarding to the correct port.

### Health endpoint returns error

```bash
curl https://your-hub/health
```

If this doesn't return `{ "status": "ok" }`, the hub is unhealthy. Check container logs:

```bash
docker compose logs -f sonde-hub
```

## Agent Issues

### Agent enrollment fails

**"Token expired"** — Enrollment tokens have a 15-minute TTL. Generate a new one from the dashboard.

**"Token already used"** — Tokens are single-use. Generate a new one.

**"Connection refused"** — The agent can't reach the hub. Verify:

- Hub URL is correct and accessible from the agent machine
- HTTPS/TLS is working (try `curl https://your-hub/health` from the agent machine)
- No firewall blocking outbound port 443

**"Certificate verification failed"** — If using self-signed certs, the agent may reject them. Check the agent's TLS configuration.

### Agent shows offline in dashboard

- Check if the agent service is running: `systemctl status sonde-agent`
- Check agent logs: `journalctl -u sonde-agent -f`
- Verify WebSocket connectivity: the agent connects to `wss://your-hub/ws/agent`
- If using a reverse proxy, ensure WebSocket upgrade headers are forwarded (`Upgrade: websocket`, `Connection: upgrade`)
- Restart the agent: `sudo systemctl restart sonde-agent`

### Packs stuck in "pending" state

The `sonde` user lacks required group memberships. Check what's needed:

```bash
sonde packs list
```

Grant access:

```bash
sudo usermod -aG docker sonde
sudo usermod -aG systemd-journal sonde
sudo systemctl restart sonde-agent
```

### Agent TUI shows "Raw mode is not supported"

The Ink TUI requires an interactive terminal (TTY). This happens when:

- Running through a pipe or script
- Running as a systemd service without `--headless`

Use `sonde start --headless` for non-interactive environments, or run `sonde` directly in an SSH session.

### Node.js version mismatch

Sonde requires Node.js 22 LTS. Check with `node --version`. If you have an older version:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## Integration Issues

### "Test Connection" fails

**Network unreachable** — The hub can't reach the external service. Verify:

- The URL is correct
- DNS resolution works from inside the hub container
- No firewall blocking outbound connections from the hub

**Authentication failed** — Double-check credentials. For OAuth integrations, ensure the client secret hasn't expired.

**SSL/TLS errors** — For self-signed certificates (common with Proxmox, Splunk, Nutanix), check **Skip TLS certificate verification** in the integration configuration. This sets `tlsRejectUnauthorized: false` for that specific integration only.

Common TLS errors and what they mean:

| Error | Meaning | Fix |
|---|---|---|
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | Server cert exists but isn't signed by a trusted CA | Skip verification or add the CA via `NODE_EXTRA_CA_CERTS` |
| `DEPTH_ZERO_SELF_SIGNED_CERT` | Server cert is self-signed | Same as above |
| `CERT_HAS_EXPIRED` | Server cert expired | Renew it on the target, or skip verification as a workaround |
| `ERR_TLS_CERT_ALTNAME_INVALID` | Hostname doesn't match the cert's SANs | Connect using the hostname in the cert, not an IP |
| `ECONNREFUSED` | Not a TLS issue — target isn't listening on the specified port | Check the URL and port |
| `ENOTFOUND` | DNS can't resolve the hostname | Check the URL from inside the hub container |

The **Activity Log** on each integration's detail page captures the full error chain for every test attempt. Expand a failed event to see the exact details.

### Proxmox "403 Forbidden"

The API token doesn't have sufficient permissions. Ensure you assigned the role to BOTH the user AND the token:

```bash
pveum acl modify / -user sonde@pve -role SondeMonitor -propagate 1
pveum acl modify / -token 'sonde@pve!sonde-token' -role SondeMonitor -propagate 1
```

## SSO Issues

### "Sign in with Microsoft" doesn't appear

SSO isn't configured. Go to **Settings** > **SSO** in the dashboard (requires owner role) and enter your Entra configuration.

### "Your account is not authorized"

The user isn't in the authorized users list or an authorized Entra group. An admin needs to add them:

- **Dashboard** > **Users** > **Add User** (by email)
- Or add their Entra group to **Authorized Groups**

### "AADSTS50011: Reply URL does not match"

The redirect URI in your Entra app registration doesn't match the hub URL. Go to Entra portal > App registration > Authentication > update the redirect URI to `https://your-exact-hub-url/auth/entra/callback`.

### "AADSTS65001: Consent required"

Admin consent hasn't been granted for the required API permissions. Go to Entra portal > App registration > API permissions > click **Grant admin consent**.

## MCP / AI Client Issues

### Claude can't connect to Sonde

- Verify the MCP endpoint is accessible: `curl https://your-hub/mcp`
- Check that your API key or OAuth setup is correct
- For Claude.ai: the hub must be publicly accessible (not local-only)
- For Claude Code: ensure the `sonde` command is in your PATH

### Probes return empty results

- Verify the agent is online in the dashboard
- Check that the relevant pack is installed and active (not pending)
- Try running the probe manually via the **Try It** panel in the dashboard
- Check agent logs: `journalctl -u sonde-agent -f`

### Probes time out

Default timeout is 30 seconds. If the target command takes longer:

- Check for performance issues on the agent machine
- Some probes (like slow query listings) may need more time
- Integration probes can be slow if the external API is responding slowly

## Performance

### Hub memory usage is high

The hub stores audit logs in SQLite. Over time, the database grows. Consider:

- Archiving old audit entries
- Monitoring database file size
- Setting up log rotation for container logs

### Agent probe execution is slow

Some probes depend on the underlying system. For example:

- `docker.logs.tail` can be slow with large log files
- `postgres.query.slow` depends on current database load
- Disk I/O affects all probes

## Getting Help

If you encounter an issue not covered here:

1. Check hub logs: `docker compose logs -f sonde-hub`
2. Check agent logs: `journalctl -u sonde-agent -f`
3. Check the dashboard audit log for error details
4. File an issue on the [GitHub repository](https://github.com/physikal/sonde) with logs and reproduction steps
