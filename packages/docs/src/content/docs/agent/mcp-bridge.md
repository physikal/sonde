---
title: MCP Bridge
---

The MCP bridge lets Claude Code (and other stdio-based MCP clients) communicate with a Sonde hub through the agent's stored credentials. It translates between the MCP stdio transport and the hub's StreamableHTTP endpoint.

## How it works

The bridge operates as a bidirectional proxy:

1. It reads JSON-RPC messages from **stdin** (newline-delimited).
2. It forwards each message as an HTTP POST to the hub's `/mcp` endpoint.
3. It writes the hub's response back to **stdout** (newline-delimited JSON-RPC).

The hub may respond with either a JSON body or a Server-Sent Events (SSE) stream. The bridge handles both transparently, parsing SSE events into individual JSON-RPC messages.

All diagnostic logging goes to **stderr** so it does not interfere with the JSON-RPC channel on stdout.

## Prerequisites

The agent must be enrolled before the bridge can be used. The bridge reads the hub URL and API key from `~/.sonde/config.json`.

```bash
# Enroll first if you haven't already
sonde enroll --hub https://your-hub:3000 --token <token>
```

## Claude Code setup

Register the bridge as an MCP server in Claude Code:

```bash
claude mcp add sonde -- sonde mcp-bridge
```

This tells Claude Code to spawn `sonde mcp-bridge` as a subprocess and communicate with it over stdio. Once registered, all Sonde tools (probes, agent listing, diagnostics) are available directly in Claude Code sessions.

## Manual usage

While the bridge is designed to be invoked by an MCP client, you can run it directly for debugging:

```bash
sonde mcp-bridge
```

The bridge will print connection details to stderr and wait for JSON-RPC input on stdin.

## Session management

The bridge tracks the `Mcp-Session-Id` header automatically. On the first request, the hub returns a session ID in the response headers. The bridge includes this header in all subsequent requests to maintain session continuity.

When stdin closes (e.g., Claude Code exits), the bridge sends an HTTP DELETE to the hub to clean up the session, then exits.

## Transport details

| Aspect | Detail |
|---|---|
| **stdin/stdout** | Newline-delimited JSON-RPC (MCP stdio transport) |
| **Hub endpoint** | `POST {hubUrl}/mcp` |
| **Auth** | `Authorization: Bearer {apiKey}` from agent config |
| **Accept** | `application/json, text/event-stream` |
| **Session** | `Mcp-Session-Id` header, tracked automatically |
| **Cleanup** | `DELETE {hubUrl}/mcp` with session ID on exit |

## Error handling

- If the hub returns a non-2xx response, the bridge sends a JSON-RPC error (`code: -32603`) back to the client with the HTTP status code.
- Network errors are logged to stderr and surfaced as JSON-RPC errors when a request ID is available.
- If the agent is not enrolled or has no API key, the bridge exits with status 1 and prints instructions to stderr.
