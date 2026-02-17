---
title: Claude Code
---

Connect Claude Code (Anthropic's CLI) to your Sonde hub to query infrastructure from the terminal.

## Option A: MCP Bridge (recommended for agent machines)

If you have a Sonde agent enrolled on the same machine, use the built-in MCP bridge. It reads the hub URL and API key from the agent's stored config at `~/.sonde/config.json`, so no extra credentials are needed.

```bash
claude mcp add sonde -- sonde mcp-bridge
```

## Option B: Direct remote MCP

If connecting directly to a hub without a local agent:

```bash
claude mcp add sonde --transport http https://your-hub-url/mcp \
  --header "Authorization: Bearer your-api-key"
```

Replace `your-hub-url` and `your-api-key` with your hub's address and a valid API key.

## Verify the connection

Start Claude Code and run a query:

```bash
claude
> List all connected sonde agents
```

If the connection is working, Claude will call the `list_agents` tool and return results.

## Available tools

- **list_agents** -- List all agents with connection status
- **agent_overview** -- Detailed info for a specific agent
- **probe** -- Execute a probe on a target agent
- **diagnose** -- Run a diagnostic runbook against an agent
