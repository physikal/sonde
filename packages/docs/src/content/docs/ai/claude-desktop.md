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

## Built-in instructions

When Claude Desktop connects to Sonde, it automatically receives structured instructions during the MCP handshake. These tell Claude how to use Sonde's tools correctly — discovering probes via `list_capabilities` before running them, using fully-qualified probe names, and understanding which probes are agent-side vs integration-side. No prompt engineering needed on your part.

Owners can customize these instructions (e.g., adding org-specific guidance) from the hub dashboard at **Settings** > **MCP Prompt**. See the [Administration Guide](/hub/administration#mcp-instructions) for details.

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

## Prompt cookbook

### Getting started

- "What agents are connected to Sonde?"
- "What diagnostics can you run on my-server?"
- "What integrations are available?"

### Outage triage

Start broad, then narrow down:

- "What's wrong with the #storefront servers?"
- "Run a health check across all #prod agents"
- "Something is slow — check all agents and integrations for issues"
- "Check the storefront critical path"

### Targeted investigation

When you know what's broken, go deeper:

- "Run a Docker diagnostic on web-01"
- "Check disk usage on my-server"
- "What's the memory usage on db-01?"
- "Show me the last 100 lines of nginx error logs on web-01"
- "Are there any slow queries on db-01?"
- "What's the status of the postgresql service on db-01?"

### Cross-system correlation

Combine agent probes with integration data:

- "Check the web servers and then look up any open ServiceNow incidents for them"
- "Show me Proxmox VM health and compare with the agent status for that host"
- "Are there any PagerDuty incidents for services related to #database agents?"
- "Check Datadog monitors and correlate with agent health on #prod"

### Capacity planning

- "Is the disk getting full on any agent?"
- "Compare memory usage across all #prod agents"
- "Do I have enough Nutanix capacity for 10 more VMs?"
- "What's the Redis memory usage trend on cache-01?"

### Tags

Use `#tagname` to scope queries to specific groups:

- "Show me #prod agents"
- "Run diagnostics on #database #linux"
- "Health check all #staging servers"
- "Check Docker on #web #prod"

### Logs and investigation

- "Show me Docker logs from the api container on web-01"
- "Query systemd journal for errors on db-01"
- "Search Splunk for errors in the last hour"
- "Query Loki for {job=\"varlogs\"} |= \"error\""
- "Show me the audit trail for probes run in the last 24 hours"

## Troubleshooting

- **First launch is slow:** `npx` downloads `mcp-remote` on first run. Subsequent launches are faster.
- **Tools don't appear:** Check Claude Desktop logs for connection errors. Verify the hub URL is reachable from your machine.
- **Auth failures:** Confirm the API key is valid. You can test it with `curl -H "Authorization: Bearer your-api-key" https://your-hub-url/health`.
- **Node.js required:** `mcp-remote` requires Node.js 18 or later installed on your machine.
