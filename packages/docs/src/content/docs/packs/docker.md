---
title: Docker Pack
---

The `docker` pack provides probes for inspecting Docker containers, images, logs, and daemon status. It gives AI assistants visibility into your containerized workloads without granting write access.

## Details

| Field | Value |
|---|---|
| **Pack name** | `docker` |
| **Version** | 0.1.0 |
| **Capability** | `observe` (read-only) |
| **Requirements** | `docker` command in PATH |
| **Auto-detection** | `docker` command exists |

The agent user must have permission to run `docker` commands (typically membership in the `docker` group).

## Probes

### `docker.containers.list`

List all Docker containers with their current status, image, ports, and names.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| *(none)* | -- | -- | -- | This probe takes no parameters. |

### `docker.logs.tail`

Tail recent log output from a specific container.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `container` | string | yes | -- | Container name or ID. |
| `lines` | number | no | 100 | Number of log lines to retrieve. |

### `docker.images.list`

List all Docker images on the host with repository, tag, and size.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| *(none)* | -- | -- | -- | This probe takes no parameters. |

### `docker.daemon.info`

Docker daemon information and resource summary, including server version, storage driver, number of containers, and system resources.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| *(none)* | -- | -- | -- | This probe takes no parameters. |

## Runbook

The Docker pack includes a default diagnostic runbook that runs these probes in parallel:

1. `docker.containers.list`
2. `docker.images.list`
3. `docker.daemon.info`

This gives a quick snapshot of the Docker environment on the target machine.

## Example usage

Ask Claude:

> "What containers are running on web-01?"

Claude will run `docker.containers.list` and return a table of all containers with their status, image, and exposed ports.

> "Show me the last 50 lines of logs from the api container on web-01."

Claude will run `docker.logs.tail` with `container: "api"` and `lines: 50`, then summarize or display the log output.

> "Is Docker healthy on the production server?"

Claude will run the full Docker diagnostic runbook -- listing containers, images, and daemon info -- and flag any issues like stopped containers, dangling images, or resource constraints.
