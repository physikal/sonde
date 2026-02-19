---
title: Claude Desktop
---

Connect Claude Desktop to your Sonde hub so you can query infrastructure directly from the chat interface.

## Configuration

Edit the Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the following MCP server entry:

```json
{
  "mcpServers": {
    "sonde": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-hub-url/mcp",
        "--header",
        "Authorization: Bearer your-api-key"
      ]
    }
  }
}
```

Replace `your-hub-url` with your hub's address and `your-api-key` with a valid API key.

:::tip[Windows: `npx` path with spaces]
If Claude Desktop fails to connect with the error `'C:\Program' is not recognized`, the space in `C:\Program Files\nodejs\npx.cmd` is breaking `cmd.exe` argument parsing. Use the Windows 8.3 short path instead:

```json
{
  "mcpServers": {
    "sonde": {
      "command": "C:\\PROGRA~1\\nodejs\\npx.cmd",
      "args": [
        "mcp-remote",
        "https://your-hub-url/mcp",
        "--header",
        "Authorization: Bearer your-api-key"
      ]
    }
  }
}
```
:::

Restart Claude Desktop after saving the file.

## Available tools

Once connected, Claude Desktop will have access to:

- **health_check** -- Start here for broad "is something wrong?" questions. Runs all applicable diagnostics in parallel. Supports tag filtering to scope to a group (e.g. `#prod`, `#storefront`).
- **list_capabilities** -- Discover all agents, integrations, their individual probes, and diagnostic categories. Use to find what specific probes are available for follow-up.
- **diagnose** -- Deep investigation of a specific category on an agent or integration (e.g. "check docker on server-1").
- **probe** -- Run a single targeted probe for a specific measurement. Good for follow-up after diagnose.
- **list_agents** -- List all agents with connection status, packs, and tags.
- **agent_overview** -- Detailed info for a specific agent.
- **query_logs** -- Investigate root cause by checking logs (Docker, systemd, nginx) or the hub audit trail.

## Tag filtering

Use `#tagname` in your prompts to filter agents and integrations by tag:

- "Show me #prod agents"
- "Run a health check on #database #linux"
- "What's wrong with the #storefront servers?"

The `#` prefix is required — without it, words are treated as natural language and no tag filtering occurs. Multiple tags use AND logic (all must match).

Tag filtering works with `list_agents`, `list_capabilities`, and `health_check`. When `health_check` is called with tags, it runs diagnostics across all matching agents in parallel and returns unified findings.

## Example prompts

- "List all connected sonde agents"
- "Show me #prod agents"
- "What's wrong with the #storefront servers?"
- "Check disk usage on my-server"
- "Run a docker diagnostic on my-server"
- "What's the memory usage on my-server?"
- "What diagnostics can you run on my-server?"

## Troubleshooting

- **First launch is slow:** `npx` downloads `mcp-remote` on first run. Subsequent launches are faster.
- **Tools don't appear:** Check Claude Desktop logs for connection errors. Verify the hub URL is reachable from your machine.
- **Auth failures:** Confirm the API key is valid. You can test it with `curl -H "Authorization: Bearer your-api-key" https://your-hub-url/health`.
- **Node.js required:** `mcp-remote` requires Node.js 18 or later installed on your machine.
