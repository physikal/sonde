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

## Built-in instructions

When Claude Code connects to Sonde, it automatically receives structured instructions during the MCP handshake. These tell Claude how to use Sonde's tools correctly — discovering probes via `list_capabilities` before running them, using fully-qualified probe names, and understanding which probes are agent-side vs integration-side. No prompt engineering needed on your part.

Owners can customize these instructions (e.g., adding org-specific guidance) from the hub dashboard at **Settings** > **MCP Prompt**. See the [Administration Guide](/hub/administration#mcp-instructions) for details.

## Available tools

- **health_check** -- Start here for broad "is something wrong?" questions. Runs all applicable diagnostics in parallel. Supports tag filtering to scope to a group (e.g. `#prod`, `#storefront`).
- **list_capabilities** -- Discover all agents, integrations, their individual probes, and diagnostic categories. Use to find what specific probes are available for follow-up.
- **diagnose** -- Deep investigation of a specific category on an agent or integration (e.g. "check docker on server-1").
- **probe** -- Run a single targeted probe for a specific measurement. Good for follow-up after diagnose.
- **list_agents** -- List all agents with connection status, packs, and tags.
- **agent_overview** -- Detailed info for a specific agent.
- **query_logs** -- Investigate root cause by checking logs (Docker, systemd, nginx) or the hub audit trail.

## Tag filtering

Use `#tagname` in your prompts to filter agents and integrations by tag:

```
> Show me #prod agents
> Run diagnostics on #database #linux
> What's wrong with the #storefront servers?
```

The `#` prefix is required — without it, words are treated as natural language and no tag filtering occurs. Multiple tags use AND logic (all must match). Tags are assigned by admins in the dashboard.

Tag filtering works with `list_agents`, `list_capabilities`, and `health_check`. When `health_check` is called with tags, it runs diagnostics across all matching agents in parallel and returns unified findings.

## Prompt cookbook

### Getting started

```
> What agents are connected to Sonde?
> What diagnostics can you run on my-server?
> What integrations are available?
```

### Outage triage

Start broad, then narrow down:

```
> What's wrong with the #storefront servers?
> Run a health check across all #prod agents
> Something is slow — check all agents and integrations for issues
> Check the storefront critical path
```

### Targeted investigation

```
> Run a Docker diagnostic on web-01
> Check disk usage on my-server
> Show me the last 100 nginx error log lines on web-01
> Are there any slow queries on db-01?
> What's the status of the postgresql service on db-01?
```

### Cross-system correlation

```
> Check the web servers and look up open ServiceNow incidents for them
> Show me Proxmox VM health and compare with agent status
> Are there PagerDuty incidents for #database agents?
> Check Datadog monitors and correlate with #prod agent health
```

### Capacity and logs

```
> Is the disk getting full on any agent?
> Compare memory usage across all #prod agents
> Show me Docker logs from the api container on web-01
> Search Splunk for errors in the last hour
> Query Loki for {job="varlogs"} |= "error"
```
