# Sonde MCP Connector Setup

Connect Claude to your Sonde hub so it can query agents, run probes, and execute diagnostic runbooks.

## Prerequisites

- A running Sonde hub (e.g. `https://mcp.sondeapp.com`)
- An API key generated during hub setup
- At least one enrolled agent

## Option A: Claude Desktop — Config File (API Key Auth)

Claude Desktop's built-in Connectors UI requires OAuth. Since Sonde currently uses API key auth, we use `mcp-remote` as a local stdio-to-HTTP bridge.

### Steps

1. Open your Claude Desktop config file:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the sonde MCP server to `mcpServers`:

```json
{
  "mcpServers": {
    "sonde": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<your-hub-url>/mcp",
        "--header",
        "Authorization: Bearer <your-api-key>"
      ]
    }
  }
}
```

3. Restart Claude Desktop.

4. In a new conversation, click the **+** button and confirm the sonde tools are listed (probe, diagnose, list_agents, agent_overview).

### Troubleshooting

- **First launch is slow**: `npx` downloads `mcp-remote` on first run. Subsequent launches are instant.
- **Server disconnected**: Check `~/Library/Logs/Claude/mcp.log` (macOS) for errors. Verify your hub URL and API key are correct.
- **Node.js not found**: `mcp-remote` requires Node.js 18+. Ensure `node` and `npx` are on your PATH.

## Option B: Claude Web (claude.ai) — Connectors UI

> **Status: Not yet supported.** The Connectors UI requires OAuth (RFC 8414 discovery + PKCE). Sonde's hub has OAuth scaffolding but does not yet expose `/.well-known/oauth-authorization-server`. This is planned for a future release.

Once OAuth is enabled, the setup will be:

1. Go to **Settings > Connectors** on [claude.ai](https://claude.ai).
2. Click **Add custom connector**.
3. Enter the hub URL: `https://<your-hub-url>/mcp`
4. (Optional) Click **Advanced settings** to enter OAuth Client ID and Client Secret.
5. Click **Add**, then authenticate when prompted.
6. In a new conversation, click **+** > **Connectors** and toggle **sonde** on.

## Option C: Claude Desktop — Connectors UI

> **Status: Not yet supported.** Same OAuth requirement as Claude Web above. Claude Desktop will not connect to remote MCP servers configured directly via the Connectors UI without OAuth discovery.

Once OAuth is enabled, the steps mirror Option B but accessed via **Settings > Connectors** in the desktop app.

## Option D: Claude Code (CLI)

Claude Code supports remote MCP servers natively. No bridge needed.

```bash
claude mcp add sonde \
  --transport http \
  "https://<your-hub-url>/mcp" \
  --header "Authorization: Bearer <your-api-key>"
```

## Available Tools

Once connected, Claude has access to:

| Tool | Description |
|------|-------------|
| `list_agents` | List all registered agents with status, packs, and last seen time |
| `agent_overview` | Detailed info about a single agent including pack details |
| `probe` | Execute a probe on a connected agent (e.g. `system.disk.usage`) |
| `diagnose` | Run a diagnostic runbook against an agent |

## Example Prompts

- "List all connected sonde agents"
- "Check disk usage on web-server-01"
- "Run a docker diagnostic on web-server-01"
- "What's the memory usage on web-server-01?"
