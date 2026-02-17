---
title: systemd Pack
---

The `systemd` pack provides probes for inspecting systemd service units and querying the journal. It is auto-detected on any Linux system running systemd.

## Details

| Field | Value |
|---|---|
| **Pack name** | `systemd` |
| **Version** | 0.1.0 |
| **Capability** | `observe` (read-only) |
| **Requirements** | `systemctl` command in PATH |
| **Auto-detection** | `/run/systemd/system` exists |

## Probes

### `systemd.services.list`

List all systemd service units with their load state, active state, and sub-state.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| *(none)* | -- | -- | -- | This probe takes no parameters. |

### `systemd.service.status`

Detailed status of a specific service unit, including its active state, PID, memory usage, and recent log lines.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `service` | string | yes | -- | Service unit name (e.g., `nginx`, `postgresql`). |

### `systemd.journal.query`

Query the systemd journal for log entries from a specific unit.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `unit` | string | yes | -- | Systemd unit name to filter logs for. |
| `lines` | number | no | 50 | Number of log entries to retrieve. |

## Runbook

The systemd pack includes a default diagnostic runbook that runs:

1. `systemd.services.list`

This provides an overview of all services and their states.

## Example usage

Ask Claude:

> "What services are running on db-01?"

Claude will run `systemd.services.list` and return all service units grouped by their active state, highlighting any failed services.

> "What's the status of the postgresql service on db-01?"

Claude will run `systemd.service.status` with `service: "postgresql"` and report whether the service is active, its uptime, memory consumption, and any recent log output.

> "Show me the last 100 journal entries for nginx on web-01."

Claude will run `systemd.journal.query` with `unit: "nginx"` and `lines: 100`, then summarize the log entries and flag any errors or warnings.
