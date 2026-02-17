---
title: Getting Started
---

Get Sonde running in three steps: deploy the hub, install an agent, and connect Claude.

## Step 1: Deploy the Hub

```bash
docker run -d --name sonde-hub \
  -p 3000:3000 \
  -e SONDE_API_KEY=your-secret-key-min-16-chars \
  -v sonde-data:/data \
  ghcr.io/sonde-dev/hub:latest
```

Open [http://localhost:3000](http://localhost:3000) and complete the setup wizard. The wizard walks through API key configuration, AI tool registration, and agent enrollment.

## Step 2: Install an Agent

On the target machine you want to monitor:

```bash
curl -fsSL https://sondeapp.com/install | bash
```

Or install manually with npm:

```bash
npm install -g @sonde/agent
sonde enroll --hub https://your-hub-url:3000 --token <enrollment-token>
sonde start --headless
```

Generate enrollment tokens from the hub dashboard or via the REST API. Each token is single-use.

## Step 3: Connect Claude

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sonde": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-hub-url:3000/mcp",
        "--header",
        "Authorization: Bearer your-api-key"
      ]
    }
  }
}
```

### Claude Code

```bash
claude mcp add sonde --transport http https://your-hub-url:3000/mcp --header "Authorization: Bearer your-api-key"
```

Then ask Claude: "What's the disk usage on my-server?"

## Architecture at a Glance

```
Claude ──MCP──> Hub ──WebSocket──> Agent ──probe──> Server
```

- **Hub** -- Central MCP server. Receives requests from AI clients and routes them to agents.
- **Agent** -- Lightweight daemon on target machines. Connects outbound to the hub via WebSocket. Never listens on a port.
- **Packs** -- Capability plugins defining available probes. Agents load packs to determine what they can inspect.

## Next Steps

- [Architecture](/reference/architecture) -- Understand the hub-and-spoke model in detail.
- [Security Model](/reference/security) -- Nine-layer defense-in-depth design.
- [Protocol Reference](/reference/protocol) -- WebSocket message format and probe lifecycle.
- [API Reference](/reference/api) -- Hub HTTP endpoints and authentication.
