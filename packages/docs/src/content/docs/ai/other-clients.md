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
| `list_agents` | List all agents with status | None |
| `agent_overview` | Detailed info for one agent | `agent` (name or ID) |
| `probe` | Execute a probe | `agent`, `probe` (e.g. `system.disk.usage`) |
| `diagnose` | Run a diagnostic runbook | `agent`, `category` (e.g. `docker`) |

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
