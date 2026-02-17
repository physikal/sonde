---
title: PostgreSQL Pack
---

The `postgres` pack provides probes for inspecting PostgreSQL databases, active connections, and slow queries. It connects via `psql` and returns structured data about database health.

## Details

| Field | Value |
|---|---|
| **Pack name** | `postgres` |
| **Version** | 0.1.0 |
| **Capability** | `observe` (read-only) |
| **Requirements** | `psql` command in PATH |
| **Auto-detection** | `psql` command exists |

The agent user must be able to connect to PostgreSQL with the specified credentials. All probes execute read-only SQL queries.

## Probes

### `postgres.databases.list`

List all PostgreSQL databases with their sizes.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `host` | string | no | `localhost` | Database host. |
| `port` | number | no | `5432` | Database port. |
| `user` | string | no | `postgres` | Database user. |

### `postgres.connections.active`

List active PostgreSQL connections with details about each session.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `host` | string | no | `localhost` | Database host. |
| `port` | number | no | `5432` | Database port. |
| `user` | string | no | `postgres` | Database user. |

### `postgres.query.slow`

List currently running queries that exceed a duration threshold. Useful for identifying long-running or blocked queries.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `host` | string | no | `localhost` | Database host. |
| `port` | number | no | `5432` | Database port. |
| `user` | string | no | `postgres` | Database user. |
| `thresholdMs` | number | no | `1000` | Minimum query duration in milliseconds. |

## Runbook

The PostgreSQL pack includes a default diagnostic runbook that runs all three probes in parallel:

1. `postgres.databases.list`
2. `postgres.connections.active`
3. `postgres.query.slow`

This gives a comprehensive snapshot of database health: what databases exist, who is connected, and whether any queries are running slowly.

## Example usage

Ask Claude:

> "What databases are on db-01 and how big are they?"

Claude will run `postgres.databases.list` and return each database with its size, helping you identify unexpectedly large databases.

> "Are there any active connections to PostgreSQL on db-01?"

Claude will run `postgres.connections.active` and summarize the current sessions, including the user, database, state, and query being executed.

> "Are there any slow queries on db-01?"

Claude will run `postgres.query.slow` with the default 1-second threshold and report any long-running queries with their duration and SQL text.

> "Find queries running longer than 5 seconds on db-01."

Claude will run `postgres.query.slow` with `thresholdMs: 5000` to surface only the most problematic queries.
