---
title: MySQL Pack
---

The `mysql` pack provides probes for inspecting MySQL databases, active processes, and server status variables. It connects via the `mysql` command-line client and returns structured data.

## Details

| Field | Value |
|---|---|
| **Pack name** | `mysql` |
| **Version** | 0.1.0 |
| **Capability** | `observe` (read-only) |
| **Requirements** | `mysql` command in PATH |
| **Auto-detection** | `mysql` command exists |

The agent user must be able to connect to MySQL with the specified credentials. All probes execute read-only queries.

## Probes

### `mysql.databases.list`

List all MySQL databases with their table counts and sizes.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `host` | string | no | `localhost` | Database host. |
| `port` | number | no | `3306` | Database port. |
| `user` | string | no | `root` | Database user. |

### `mysql.processlist`

Show active MySQL processes, including the user, host, database, command state, and query text for each connection.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `host` | string | no | `localhost` | Database host. |
| `port` | number | no | `3306` | Database port. |
| `user` | string | no | `root` | Database user. |

### `mysql.status`

Get MySQL server status variables including uptime, queries per second, thread counts, and buffer pool usage.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `host` | string | no | `localhost` | Database host. |
| `port` | number | no | `3306` | Database port. |
| `user` | string | no | `root` | Database user. |

## Runbook

The MySQL pack includes a default diagnostic runbook that runs all three probes in parallel:

1. `mysql.databases.list`
2. `mysql.processlist`
3. `mysql.status`

This provides a comprehensive view of MySQL health: database sizes, active connections, and server performance metrics.

## Example usage

Ask Claude:

> "What databases are on the MySQL server on db-02?"

Claude will run `mysql.databases.list` and return each database with its table count and total size.

> "Are there any long-running queries on the MySQL server?"

Claude will run `mysql.processlist` and highlight any processes with high execution times or blocking states.

> "What's the overall health of MySQL on db-02?"

Claude will run the full MySQL diagnostic runbook -- listing databases, active processes, and server status -- and provide a summary of any issues like high thread counts, slow queries, or oversized databases.

> "Check MySQL on a replica running on port 3307."

Claude will run the probes with `host: "localhost"` and `port: 3307` to target the replica instance.
