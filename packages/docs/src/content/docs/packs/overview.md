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

## Capability levels

Every probe declares a capability level that controls what it is allowed to do:

| Level | Description | Examples |
|---|---|---|
| `observe` | Read-only data collection. This is the default and the only level used by built-in packs today. | Disk usage, container list, service status |
| `interact` | Safe mutations that do not risk data loss. | Restart a service, scale a container |
| `manage` | Dangerous operations that could cause data loss or downtime. | Drop a database, delete a volume |

The agent's policy engine enforces these levels. Probes at higher capability levels require explicit opt-in.

## Auto-detection

When an agent starts, it scans the system for installed software and matches against pack detection rules. Detection rules can check for:

- **Commands** -- binaries that must exist in `PATH` (e.g., `docker`, `psql`)
- **Files** -- paths that must exist on the filesystem (e.g., `/etc/nginx/nginx.conf`, `/run/systemd/system`)
- **Services** -- systemd units that must be present

The agent then activates matching packs and reports their probes to the hub.

## Built-in packs

Sonde ships with 7 official packs:

| Pack | Description | Detects via |
|---|---|---|
| [system](/packs/system/) | CPU, memory, and disk metrics | `/proc/loadavg` |
| [docker](/packs/docker/) | Containers, images, logs, daemon info | `docker` command |
| [systemd](/packs/systemd/) | Service units and journal logs | `/run/systemd/system` |
| [nginx](/packs/nginx/) | Config validation, access and error logs | `nginx` command, `/etc/nginx/nginx.conf` |
| [postgres](/packs/postgres/) | Databases, connections, slow queries | `psql` command |
| [redis](/packs/redis/) | Server info, key counts, memory stats | `redis-cli` command |
| [mysql](/packs/mysql/) | Databases, process list, server status | `mysql` command |

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
