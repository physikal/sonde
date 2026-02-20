---
title: Agent Installation
---

The Sonde agent is a lightweight daemon that runs on target machines and connects outbound to your hub. It collects infrastructure data through structured probes and sends results back over WebSocket.

## Quick install

The fastest way to install is the one-liner bootstrap script. It installs Node.js 22, the `@sonde/agent` npm package globally, and launches the interactive setup TUI:

```bash
curl -fsSL https://your-hub-url/install | sh
```

The hub serves this bootstrap script directly (requires `SONDE_HUB_URL` to be set on the hub). The script auto-detects your platform and package manager:

- **Debian / Ubuntu** -- installs via `apt`
- **RHEL / Fedora** -- installs via `dnf`
- **CentOS / Amazon Linux** -- installs via `yum`
- **macOS** -- installs via Homebrew

## npm install

If you already have Node.js 22+ installed, you can install the agent directly:

```bash
npm install -g @sonde/agent
```

After installation, the `sonde` command is available globally.

## Verify installation

```bash
sonde --version
```

## System requirements

| Requirement | Details |
|---|---|
| **Runtime** | Node.js 22 LTS or later |
| **Network** | Outbound HTTPS and WSS to the hub (no inbound ports required) |
| **OS** | Linux (x86_64, arm64) or macOS |
| **Privileges** | Runs as a regular user. The agent refuses to run as root. |

## What happens next

After installation, enroll the agent with your hub:

```bash
sonde enroll --hub https://your-hub:3000 --token <token>
```

Or run the interactive guided setup:

```bash
sonde install --hub https://your-hub:3000
```

See [Enrollment](/agent/enrollment/) for details.
