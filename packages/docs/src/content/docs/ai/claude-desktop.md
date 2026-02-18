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

- **list_agents** -- List all agents with connection status
- **agent_overview** -- Detailed info for a specific agent
- **probe** -- Execute a probe on a target agent
- **diagnose** -- Run a diagnostic runbook against an agent

## Example prompts

- "List all connected sonde agents"
- "Check disk usage on my-server"
- "Run a docker diagnostic on my-server"
- "What's the memory usage on my-server?"

## Troubleshooting

- **First launch is slow:** `npx` downloads `mcp-remote` on first run. Subsequent launches are faster.
- **Tools don't appear:** Check Claude Desktop logs for connection errors. Verify the hub URL is reachable from your machine.
- **Auth failures:** Confirm the API key is valid. You can test it with `curl -H "Authorization: Bearer your-api-key" https://your-hub-url/health`.
- **Node.js required:** `mcp-remote` requires Node.js 18 or later installed on your machine.
