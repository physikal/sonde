---
title: API Reference
---

HTTP and WebSocket endpoints exposed by the Sonde hub.

## Authentication

All endpoints (except where noted) require authentication via one of:

- **Bearer token** in the `Authorization` header (preferred):
  ```
  Authorization: Bearer <api-key>
  ```
- **Query parameter** (fallback):
  ```
  ?apiKey=<api-key>
  ```

**Key types:**

| Type | Scope |
|------|-------|
| Master API key | Full access to all endpoints and agents |
| Scoped API key | Restricted by policy rules (specific agents and tools) |

## MCP Endpoint

The MCP endpoint implements the StreamableHTTP transport for AI client integration.

### MCP Server Instructions

The hub sends an `instructions` string during the MCP initialization handshake. This provides AI clients with structured guidance about Sonde's workflow, probe naming conventions, and active integrations. Instructions are built per-session from:

1. Optional custom prefix (set by owner via `/api/v1/settings/mcp-instructions`)
2. Core Sonde workflow guidance (always present)
3. Dynamic list of active integrations

### `POST /mcp`

Send JSON-RPC messages to the MCP server. Returns JSON or SSE depending on the request.

**Headers:**
- `Authorization: Bearer <api-key>` (required)
- `Content-Type: application/json`
- `Accept: application/json, text/event-stream`
- `Mcp-Session-Id: <session-id>` (required after initialization)

### `DELETE /mcp`

End an MCP session.

**Headers:**
- `Authorization: Bearer <api-key>` (required)
- `Mcp-Session-Id: <session-id>` (required)

### MCP Tools

The following tools are available to AI clients via `tools/list` and `tools/call`:

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `health_check` | Start here for broad "is something wrong?" questions. Runs all applicable diagnostics in parallel. Supports tag filtering to scope to a group. | Optional `agent`, `categories`, `tags` |
| `list_capabilities` | Discover all agents, integrations, their individual probes, and diagnostic categories. | Optional `tags` |
| `diagnose` | Deep investigation of a specific category on an agent or integration. | `agent` or `integration`, `category` |
| `probe` | Run a single targeted probe for a specific measurement. | `agent` or `integration`, `probe` |
| `list_agents` | List all agents with connection status, packs, and tags. | Optional `tags` |
| `agent_overview` | Detailed info for a specific agent. | `agent` (name or ID) |
| `query_logs` | Query logs from agents (Docker, systemd, nginx) or the hub audit trail. | `source`, optional `agent`, filters |

The `tags` parameter accepts an array of tag names (without `#` prefix). When provided, results are filtered to agents and integrations matching **all** specified tags (AND logic).

## REST API

### Health

#### `GET /health`

Health check. **No authentication required.**

**Response:**
```json
{
  "status": "ok"
}
```

### Setup

#### `GET /api/v1/setup/status`

Get setup wizard completion status. **No authentication required.**

**Response:**
```json
{
  "completed": false
}
```

#### `POST /api/v1/setup/complete`

Mark setup as complete. Can only be called once; returns `409 Conflict` on subsequent calls.

**Response:** `200 OK`

### Agents

#### `GET /api/v1/agents`

List all registered agents with connection status.

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "my-server",
    "hostname": "my-server.local",
    "os": "linux",
    "status": "online",
    "version": "0.3.0",
    "packs": ["system", "docker"],
    "lastSeen": "2026-02-16T12:00:00.000Z"
  }
]
```

#### `GET /api/v1/agents/:id`

Get detailed information for a single agent.

**Response:**
```json
{
  "id": "uuid",
  "name": "my-server",
  "hostname": "my-server.local",
  "os": "linux",
  "osVersion": "Ubuntu 22.04",
  "arch": "x64",
  "status": "online",
  "version": "0.3.0",
  "packs": ["system", "docker"],
  "capabilities": ["system.disk.usage", "system.memory.usage", "docker.containers.list"],
  "lastSeen": "2026-02-16T12:00:00.000Z",
  "enrolledAt": "2026-02-15T10:00:00.000Z"
}
```

### Audit Log

#### `GET /api/v1/audit`

Query the audit log. Entries are returned in reverse chronological order.

**Response:**
```json
[
  {
    "id": "uuid",
    "timestamp": "2026-02-16T12:00:00.000Z",
    "action": "probe.request",
    "agentId": "uuid",
    "probe": "system.disk.usage",
    "requestedBy": "api",
    "status": "success",
    "durationMs": 142,
    "hash": "sha256-hex"
  }
]
```

### API Keys (Admin)

Admin-only endpoints for managing all keys across the deployment. Requires `admin` role or higher.

#### `POST /api/v1/api-keys`

Create a new API key. Optionally scope it with policy rules.

**Request:**
```json
{
  "name": "ci-readonly",
  "role": "member",
  "policy": {
    "allowedAgents": ["my-server"],
    "allowedProbes": ["system.*"]
  }
}
```

**Response:**
```json
{
  "id": "uuid",
  "name": "ci-readonly",
  "key": "a1b2c3...",
  "policy": { "role": "member" }
}
```

The `key` value is only returned once at creation time.

#### `GET /api/v1/api-keys`

List all API keys (without the key values).

#### `POST /api/v1/api-keys/:id/rotate`

Generate a new key value. The old value is immediately invalidated.

#### `DELETE /api/v1/api-keys/:id`

Revoke an API key. Immediately invalidates all sessions using this key.

### My API Keys (Self-Service)

Self-service endpoints for managing your own keys. Available to any authenticated user (member, admin, owner). Keys created here are always scoped to `member` role. Maximum 5 keys per user. Operations on keys not owned by the caller return `404`.

#### `GET /api/v1/my/api-keys`

List the caller's own API keys (active only, excludes revoked).

**Response:**
```json
{
  "keys": [
    {
      "id": "uuid",
      "name": "claude-desktop",
      "createdAt": "2026-02-16T12:00:00.000Z",
      "lastUsedAt": "2026-02-17T08:30:00.000Z",
      "role": "member",
      "keyType": "mcp"
    }
  ]
}
```

#### `POST /api/v1/my/api-keys`

Create a new personal API key. Role is hardcoded to `member`.

**Request:**
```json
{
  "name": "claude-desktop"
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "key": "a1b2c3...",
  "name": "claude-desktop"
}
```

Returns `400` if the user already has 5 active keys.

#### `POST /api/v1/my/api-keys/:id/rotate`

Generate a new key value for an owned key. Returns `404` if the key doesn't belong to the caller.

**Response:**
```json
{
  "id": "uuid",
  "key": "d4e5f6..."
}
```

#### `DELETE /api/v1/my/api-keys/:id`

Revoke an owned key. Returns `404` if the key doesn't belong to the caller.

### Enrollment Tokens

#### `POST /api/v1/enrollment-tokens`

Create a single-use enrollment token for agent registration.

**Response:**
```json
{
  "token": "enroll_...",
  "expiresAt": "2026-02-17T12:00:00.000Z"
}
```

### Install Script

#### `GET /install`

Returns a bash bootstrap script for agent installation. **No authentication required.**

Usage:
```bash
curl -fsSL https://your-hub-url:3000/install | bash
```

The script installs Node.js 22 (if needed) and `@sonde/agent`, then launches the enrollment TUI. Supports Linux (apt, dnf, yum) and macOS (Homebrew).

### Settings

#### `GET /api/v1/settings/mcp-instructions`

Get the current MCP instructions configuration. **Requires owner role.**

**Response:**
```json
{
  "customPrefix": "Your org-specific guidance here.",
  "preview": "Your org-specific guidance here.\n\n# Sonde Infrastructure Diagnostics\n..."
}
```

The `preview` field contains the full assembled instructions string that AI clients receive.

#### `PUT /api/v1/settings/mcp-instructions`

Update the custom prefix for MCP instructions. **Requires owner role.**

**Request:**
```json
{
  "customPrefix": "You are assisting the ACME Corp infrastructure team."
}
```

**Response:**
```json
{
  "ok": true,
  "preview": "You are assisting the ACME Corp infrastructure team.\n\n# Sonde Infrastructure Diagnostics\n..."
}
```

The `customPrefix` field accepts up to 2000 characters. Set to an empty string to remove the prefix.

## WebSocket Endpoints

### `GET /ws/agent`

Agent WebSocket connection. Authenticated via Bearer token (API key or enrollment token) during the HTTP upgrade.

Protocol: JSON message envelopes as defined in the [Protocol Reference](/reference/protocol).

### `GET /ws/dashboard`

Dashboard WebSocket connection. Receives real-time agent status updates (connect, disconnect, heartbeat) as JSON messages. Used by the dashboard SPA for live fleet status.
