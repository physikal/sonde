---
title: Packs Overview
---

Packs are capability plugins that define what an agent can observe on the machine it runs on. They are the bridge between an AI assistant asking a question ("what's the disk usage?") and the structured probe that collects the answer.

## What a pack contains

Each pack declares three things:

1. **Metadata** -- name, version, and description.
2. **Detection rules** -- what software or files to look for so the agent can auto-suggest relevant packs.
3. **Probes** -- structured, read-only operations that collect data and return JSON.

Probes never return raw text. Every probe handler parses command output into a typed JSON structure before returning it to the hub.

## Read-only by design

All probes are strictly read-only. Sonde never modifies, restarts, or changes anything on your infrastructure. Every probe collects diagnostic data and returns structured JSON — nothing more. This is a core design principle, not a configuration option.

## Auto-detection

When an agent starts, it scans the system for installed software and matches against pack detection rules. Detection rules can check for:

- **Commands** -- binaries that must exist in `PATH` (e.g., `docker`, `psql`)
- **Files** -- paths that must exist on the filesystem (e.g., `/etc/nginx/nginx.conf`, `/run/systemd/system`)
- **Services** -- systemd units that must be present

The agent then activates matching packs and reports their probes to the hub.

## Built-in packs

Sonde ships with 8 official agent packs:

| Pack | Description | Detects via |
|---|---|---|
| [system](/packs/system/) | CPU, memory, disk, and network ping | `/proc/loadavg` |
| [docker](/packs/docker/) | Containers, images, logs, daemon info | `docker` command |
| [systemd](/packs/systemd/) | Service units and journal logs | `/run/systemd/system` |
| [nginx](/packs/nginx/) | Config validation, access and error logs | `nginx` command, `/etc/nginx/nginx.conf` |
| [postgres](/packs/postgres/) | Databases, connections, slow queries | `psql` command |
| [redis](/packs/redis/) | Server info, key counts, memory stats | `redis-cli` command |
| [mysql](/packs/mysql/) | Databases, process list, server status | `mysql` command |
| proxmox-node | Proxmox VE node-local: VM/LXC config, HA, LVM, Ceph | `/usr/sbin/qm` or `/usr/sbin/pct` |

## Managing packs

Use the `sonde packs` CLI on the agent machine to manage which packs are active.

### List installed packs

```bash
sonde packs list
```

Shows all currently installed packs with their probes. Pack names are shown in **bold** — use that exact name for install/uninstall commands.

### Scan for available software

```bash
sonde packs scan
```

Auto-detects installed software on the machine and reports which packs are available. Packs marked `(installed)` are already active; packs marked `(available)` can be installed.

### Install a pack

```bash
sonde packs install docker
```

Activates the pack and makes its probes available to the hub. If the `sonde` user lacks required group memberships (e.g., the `docker` group for the Docker pack), the command prints instructions:

```
Pack "docker" requires additional permissions:
  Missing groups: docker
  To grant access:
    sudo usermod -aG docker sonde
```

After granting access, restart the agent for the change to take effect.

### Uninstall a pack

```bash
sonde packs uninstall docker
```

Removes the pack. Its probes are no longer available to the hub. The pack name must match exactly as shown in `sonde packs list` (e.g., `proxmox-node`, not `proxmox`).

## Pack signing

Official packs are code-signed with RSA-SHA256. The agent verifies signatures at load time when signature enforcement is enabled. Unsigned or community packs require explicit opt-in via the `allowUnsignedPacks` configuration flag.

The signing process covers the full pack manifest (name, version, probes, requirements, detection rules) so any tampering invalidates the signature.

## How probes execute

1. An AI assistant sends a probe request through the hub (e.g., "run `system.disk.usage` on agent `web-01`").
2. The hub routes the request to the target agent over WebSocket.
3. The agent looks up the probe handler in the active pack registry.
4. The handler runs one or more system commands via the injected `exec` function, parses the output, and returns structured JSON.
5. The result flows back through the hub to the AI assistant.

Agents never execute raw shell commands. The probe handler defines exactly which commands are run and how the output is parsed.

## Creating custom packs

You can create your own packs to cover software not included in the built-in set. See [Creating a Pack](/packs/creating/) for a step-by-step guide.
