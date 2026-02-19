---
title: Other MCP Clients
---

Sonde works with any MCP-compatible client. This page covers the protocol details needed to integrate a custom or third-party client.

## MCP endpoint

- **URL:** `https://your-hub-url/mcp`
- **Transport:** StreamableHTTP (POST with JSON body, responses are JSON or SSE)
- **Auth:** Bearer token in the `Authorization` header

## Connection flow

1. Send an `initialize` JSON-RPC request to `/mcp`.
2. Note the `mcp-session-id` value in the response headers.
3. Include the `Mcp-Session-Id` header in all subsequent requests.
4. Call `tools/list` to discover available tools.
5. Call `tools/call` with a tool name and arguments to execute operations.

## Available tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `health_check` | Start here for broad "is something wrong?" questions. Runs all applicable diagnostics in parallel. Supports tag filtering to scope to a group. | Optional `agent`, `categories`, `tags` |
| `list_capabilities` | Discover all agents, integrations, their individual probes, and diagnostic categories. Use to find what specific probes are available for follow-up. | Optional `tags` filter |
| `diagnose` | Deep investigation of a specific category on an agent or integration (e.g. "check docker on server-1"). | `agent`, `category` (e.g. `docker`) |
| `probe` | Run a single targeted probe for a specific measurement. Good for follow-up after diagnose. | `agent`, `probe` (e.g. `system.disk.usage`) |
| `list_agents` | List all agents with connection status, packs, and tags. | Optional `tags` filter |
| `agent_overview` | Detailed info for a specific agent. | `agent` (name or ID) |
| `query_logs` | Investigate root cause by checking logs (Docker, systemd, nginx) or the hub audit trail. | `source`, `agent`, optional filters |

:::tip[Tag filtering]
Use `#tagname` syntax in your prompts to filter by tags. For example: *"List #prod agents"*, *"Check capabilities for #database #linux"*, or *"What's wrong with the #storefront servers?"*. The `#` prefix is required — without it, words are treated as natural language and no filtering occurs. Multiple tags use AND logic (all must match).

Tag filtering works with `list_agents`, `list_capabilities`, and `health_check`. When `health_check` is called with tags, it runs diagnostics across all matching agents in parallel and returns unified findings.
:::

## Example with curl

Initialize a session:

```bash
curl -X POST https://your-hub-url/mcp \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "capabilities": {},
      "clientInfo": {
        "name": "my-client",
        "version": "1.0"
      }
    }
  }'
```

Extract the `mcp-session-id` from the response headers, then list tools:

```bash
curl -X POST https://your-hub-url/mcp \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: SESSION_ID_FROM_ABOVE" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}'
```

## REST API alternative

For non-MCP clients, the hub also exposes REST endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/v1/agents` | GET | List agents |

All REST endpoints require the `Authorization: Bearer <api-key>` header.
