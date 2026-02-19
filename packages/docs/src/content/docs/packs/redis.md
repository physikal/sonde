---
title: Redis Pack
---

The `redis` pack provides probes for inspecting Redis server info, key counts, and memory usage. It connects via `redis-cli` and returns structured data about your Redis instance.

## Details

| Field | Value |
|---|---|
| **Pack name** | `redis` |
| **Version** | 0.1.0 |
| **Capability** | `observe` (read-only) |
| **Requirements** | `redis-cli` command in PATH |
| **Auto-detection** | `redis-cli` command exists |

All probes execute read-only commands against the Redis server.

## Probes

### `redis.info`

Get Redis server info including version, uptime, connected clients, and memory usage.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `host` | string | no | `127.0.0.1` | Redis host. |
| `port` | number | no | `6379` | Redis port. |

### `redis.keys.count`

Count the number of keys per database.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `host` | string | no | `127.0.0.1` | Redis host. |
| `port` | number | no | `6379` | Redis port. |

### `redis.memory.usage`

Get Redis memory usage statistics including peak memory, fragmentation ratio, and allocator details.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `host` | string | no | `127.0.0.1` | Redis host. |
| `port` | number | no | `6379` | Redis port. |

## Runbook

The Redis pack includes a default diagnostic runbook that runs these probes in parallel:

1. `redis.info`
2. `redis.memory.usage`
3. `redis.keys.count`

This provides a full picture of Redis health: server status, memory pressure, and data volume.

## Example usage

Ask Claude:

> "What's the Redis server status on cache-01?"

Claude will run `redis.info` and report the Redis version, uptime, number of connected clients, and memory consumption.

> "How many keys are stored in Redis on cache-01?"

Claude will run `redis.keys.count` and return the key count broken down by database.

> "Is Redis running low on memory on cache-01?"

Claude will run `redis.memory.usage` and analyze memory allocation, peak usage, and fragmentation ratio, flagging any concerns.

> "Check Redis on a non-standard port."

Claude will run `redis.info` with `host: "127.0.0.1"` and `port: 6380` to connect to a Redis instance on a custom port.
