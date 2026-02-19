---
title: Agent Enrollment
---

Enrollment connects an agent to a hub and establishes its identity. During enrollment, the agent registers with the hub, receives a UUID, and obtains credentials for persistent reconnection.

## Authentication methods

### Enrollment token (recommended)

Enrollment tokens are single-use, time-limited credentials generated in the hub dashboard. They expire after 15 minutes.

```bash
sonde enroll --hub https://your-hub:3000 --token <token>
```

On successful token enrollment, the hub mints a scoped API key for the agent. This key is saved locally and used for all subsequent connections. The one-time token is discarded after use.

### API key

You can also enroll using a hub API key directly:

```bash
sonde enroll --hub https://your-hub:3000 --key <api-key>
```

## Options

| Flag | Description | Default |
|---|---|---|
| `--hub <url>` | Hub URL (required) | -- |
| `--token <token>` | Enrollment token | -- |
| `--key <key>` | API key | -- |
| `--name <name>` | Agent display name | System hostname |

Either `--token` or `--key` is required.

## What happens during enrollment

1. The agent connects to the hub over WebSocket.
2. It sends a registration message with its name, version, and available packs.
3. The hub assigns a UUID and acknowledges the registration.
4. If using a token, the hub mints a scoped API key (e.g., `agent:<name>`) and returns it in the acknowledgement.
5. The agent saves its configuration to `~/.sonde/config.json`.

## Stable identity

Re-enrolling with the same `--name` reuses the existing UUID. This means you can re-enroll an agent (for example, after reinstalling) without losing its identity or history in the hub.

## mTLS certificates

If the hub has mTLS enabled, it issues a client certificate and CA certificate during enrollment. These are saved to `~/.sonde/` and used for all subsequent connections:

- `~/.sonde/cert.pem` -- agent client certificate
- `~/.sonde/key.pem` -- agent private key
- `~/.sonde/ca.pem` -- hub CA certificate

## Configuration file

Enrollment saves configuration to `~/.sonde/config.json`:

```json
{
  "hubUrl": "https://your-hub:3000",
  "apiKey": "agent:my-server:abc123...",
  "agentName": "my-server",
  "agentId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Interactive setup

For a guided experience that combines enrollment with software detection and pack selection, use the interactive installer:

```bash
sonde install --hub https://your-hub:3000
```

This launches a TUI that walks through enrollment, scans for installed software (Docker, systemd, Nginx, PostgreSQL, etc.), and lets you choose which packs to enable.

## Verifying enrollment

After enrolling, check the agent status:

```bash
sonde status
```

```
Sonde Agent Status
  Name:     my-server
  Hub:      https://your-hub:3000
  Agent ID: 550e8400-e29b-41d4-a716-446655440000
  Config:   /home/user/.sonde/config.json
```
