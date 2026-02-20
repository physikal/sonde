---
title: CLI Reference
---

The `sonde` command is the primary interface for managing the Sonde agent. It handles enrollment, runtime, pack management, and updates.

## Usage

```
sonde [command] [options]
```

When invoked without a command, `sonde` launches the management TUI if the agent is enrolled, or prints usage information otherwise.

## Commands

### `sonde install`

Interactive guided setup. Launches a TUI that walks through hub enrollment, software detection, and pack selection.

```bash
sonde install --hub https://your-hub:3000
```

| Option | Description |
|---|---|
| `--hub <url>` | Hub URL to pre-fill in the setup wizard |

### `sonde enroll`

Enroll this agent with a hub. Establishes identity and saves credentials for persistent connection.

```bash
# Using an enrollment token (recommended)
sonde enroll --hub https://your-hub:3000 --token abc123

# Using an API key
sonde enroll --hub https://your-hub:3000 --key your-api-key

# With a custom agent name
sonde enroll --hub https://your-hub:3000 --token abc123 --name prod-web-01
```

| Option | Description | Default |
|---|---|---|
| `--hub <url>` | Hub URL (required) | -- |
| `--key <key>` | API key for authentication | -- |
| `--token <token>` | Enrollment token (alternative to `--key`) | -- |
| `--name <name>` | Agent display name | System hostname |

### `sonde start`

Start the agent and connect to the hub. By default, launches the management TUI with a live dashboard.

```bash
# Start with TUI
sonde start

# Start headless (for systemd, background processes, or CI)
sonde start --headless
```

| Option | Description |
|---|---|
| `--headless` | Run without TUI. Suitable for systemd services or background execution. |

### `sonde stop`

Stop the background agent process.

```bash
sonde stop
```

### `sonde restart`

Restart the agent in background mode.

```bash
sonde restart
```

### `sonde status`

Display current agent status, including name, hub URL, agent ID, and config file path.

```bash
sonde status
```

Example output:

```
Sonde Agent Status
  Name:     my-server
  Hub:      https://your-hub:3000
  Agent ID: 550e8400-e29b-41d4-a716-446655440000
  Config:   /home/user/.sonde/config.json
```

If the agent is not enrolled, it prints a message directing you to run `sonde enroll`.

### `sonde packs`

Manage probe packs. Packs define the probes available on this agent (e.g., system metrics, Docker containers, systemd services).

```bash
# List installed packs
sonde packs list

# Scan for available software and suggest packs
sonde packs scan

# Install a pack
sonde packs install docker

# Uninstall a pack
sonde packs uninstall docker
```

### `sonde update`

Check for and install agent updates from the npm registry.

```bash
sonde update
```

This compares the installed version against the latest published version of `@sonde/agent`. If an update is available, it runs `npm install -g @sonde/agent@<version>` and attempts to restart the systemd service if one is configured.

### `sonde mcp-bridge`

Start the stdio MCP bridge for Claude Code integration. This command is typically invoked by Claude Code, not run directly.

```bash
sonde mcp-bridge
```

See [MCP Bridge](/agent/mcp-bridge/) for details.

## Global flags

| Flag | Description |
|---|---|
| `--version`, `-v` | Print the agent version and exit |

## Configuration

All agent configuration is stored in `~/.sonde/config.json`. This file is created during enrollment and updated automatically. See [Enrollment](/agent/enrollment/) for the config structure.
