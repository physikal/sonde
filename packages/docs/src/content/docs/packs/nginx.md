---
title: Nginx Pack
---

The `nginx` pack provides probes for validating Nginx configuration and tailing access and error logs. It helps AI assistants diagnose web server issues without needing shell access.

## Details

| Field | Value |
|---|---|
| **Pack name** | `nginx` |
| **Version** | 0.1.0 |
| **Capability** | `observe` (read-only) |
| **Requirements** | `nginx` command in PATH, `/etc/nginx/nginx.conf` exists |
| **Auto-detection** | `nginx` command exists and `/etc/nginx/nginx.conf` exists |

The agent user must have read access to the Nginx configuration files and log files.

## Probes

### `nginx.config.test`

Test the Nginx configuration for syntax errors. Runs `nginx -t` and reports whether the configuration is valid.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| *(none)* | -- | -- | -- | This probe takes no parameters. |

### `nginx.access.log.tail`

Tail recent lines from the Nginx access log.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `logPath` | string | no | `/var/log/nginx/access.log` | Path to the access log file. |
| `lines` | number | no | 100 | Number of lines to tail. |

### `nginx.error.log.tail`

Tail recent lines from the Nginx error log.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `logPath` | string | no | `/var/log/nginx/error.log` | Path to the error log file. |
| `lines` | number | no | 100 | Number of lines to tail. |

## Runbook

The Nginx pack includes a default diagnostic runbook that runs these probes in parallel:

1. `nginx.config.test`
2. `nginx.error.log.tail`

This validates the config and surfaces recent errors in a single operation.

## Example usage

Ask Claude:

> "Is the Nginx config valid on web-01?"

Claude will run `nginx.config.test` and report whether the syntax check passed or failed, including any error details.

> "Show me recent Nginx errors on the load balancer."

Claude will run `nginx.error.log.tail` and summarize the most recent error entries, highlighting patterns like upstream timeouts or permission issues.

> "What traffic is hitting web-01?"

Claude will run `nginx.access.log.tail` and analyze the recent access log entries, summarizing request patterns, status codes, and client IPs.

> "Check the error log at /var/log/nginx/app-error.log on web-01."

Claude will run `nginx.error.log.tail` with `logPath: "/var/log/nginx/app-error.log"` to read from a custom log location.
