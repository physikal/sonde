---
title: System Pack
---

The `system` pack provides basic operating system metrics: disk usage, memory and swap consumption, and CPU load averages. It is the most fundamental pack and works on any Linux system.

## Details

| Field | Value |
|---|---|
| **Pack name** | `system` |
| **Version** | 0.1.0 |
| **Capability** | `observe` (read-only) |
| **Requirements** | `df` and `ping` commands in PATH |
| **Auto-detection** | `/proc/loadavg` exists |

## Probes

### `system.disk.usage`

Disk usage per mounted filesystem. Runs `df -kP` and parses the POSIX-format output. Pseudo-filesystems (`tmpfs`, `devtmpfs`) are filtered out.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| *(none)* | -- | -- | -- | This probe takes no parameters. |

Returns an object with a `filesystems` array:

```json
{
  "filesystems": [
    {
      "filesystem": "/dev/sda1",
      "sizeKb": 51474044,
      "usedKb": 31285940,
      "availableKb": 17548392,
      "usePct": 65,
      "mountedOn": "/"
    }
  ]
}
```

### `system.memory.usage`

System memory and swap usage. Runs `free -b` and parses the output into byte values.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| *(none)* | -- | -- | -- | This probe takes no parameters. |

Returns:

```json
{
  "totalBytes": 16777216000,
  "usedBytes": 8388608000,
  "freeBytes": 4194304000,
  "availableBytes": 12582912000,
  "swap": {
    "totalBytes": 8589934592,
    "usedBytes": 0,
    "freeBytes": 8589934592
  }
}
```

### `system.cpu.usage`

CPU load averages and core count. Reads `/proc/loadavg` and runs `nproc` to determine the number of CPU cores. You can compute CPU utilization as `loadAvg / cpuCount`.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| *(none)* | -- | -- | -- | This probe takes no parameters. |

Returns:

```json
{
  "loadAvg1": 2.10,
  "loadAvg5": 1.50,
  "loadAvg15": 0.90,
  "cpuCount": 16
}
```

### `system.network.ping`

Ping a remote host and return packet loss and round-trip time statistics. Cross-platform (Linux and macOS).

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `host` | string | yes | -- | Hostname or IP address to ping. |
| `count` | number | no | 4 | Number of ping packets to send (max 20). |

Returns:

```json
{
  "host": "10.0.0.1",
  "packetsTransmitted": 4,
  "packetsReceived": 4,
  "packetLossPercent": 0,
  "rttMs": {
    "min": 0.5,
    "avg": 1.2,
    "max": 2.1,
    "stddev": 0.6
  }
}
```

## Example usage

Ask Claude:

> "What's the disk usage on web-01?"

Claude will run the `system.disk.usage` probe on the `web-01` agent and return a summary of each mounted filesystem with usage percentages.

> "Is the server running low on memory?"

Claude will run `system.memory.usage` and compare used memory against total and available memory, flagging any concerns.

> "Is the CPU overloaded on db-01?"

Claude will run `system.cpu.usage`, compare the 1-minute load average against the core count, and tell you whether the system is under pressure.
