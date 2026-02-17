---
title: Security Model
---

Sonde implements a nine-layer defense-in-depth security model. The core principle: every hop authenticates, every payload is signed, every operation is logged, and the agent never runs as root.

## Layer 1: Agent Privilege Model

The agent runs as a dedicated `sonde` system user, never as root. Access to system resources is granted through group membership:

- `docker` -- read container and image info
- `systemd-journal` -- read journal logs
- `adm` -- read system logs
- `postgres` -- read database metrics

Packs declare their required permissions. The agent requests approval for group access during installation.

## Layer 2: No Raw Shell Execution

There is no code path from MCP tool calls to arbitrary shell execution. The agent only accepts structured probe descriptors (e.g., `system.disk.usage` with typed parameters). Internally, the agent maps these descriptors to specific, predefined commands. An AI client cannot construct a request that results in arbitrary command execution.

## Layer 3: Capability Levels

Every probe declares one of three capability levels:

| Level | Description | Examples |
|-------|-------------|----------|
| `observe` | Read-only queries (default) | Disk usage, container list, service status |
| `interact` | Safe mutations | Restart a service, pull an image |
| `manage` | Dangerous operations | Delete containers, modify configs |

The agent configuration sets a maximum capability ceiling. Probes above the ceiling are not loaded, regardless of what packs are installed. Most deployments use `observe` only.

## Layer 4: Wire Security (Agent to Hub)

All WebSocket connections use TLS. Additional protections:

- **mTLS (optional):** The hub acts as a certificate authority during enrollment, issuing client certificates to agents. On subsequent connections, both sides authenticate.
- **Payload signing:** Every message envelope includes an RSA-SHA256 signature over the payload. The receiver verifies against the sender's known public key.

## Layer 5: Client Security (Hub to AI)

AI clients authenticate to the hub MCP endpoint via:

- **API keys:** Bearer token in the `Authorization` header. Master key for full access; scoped keys for restricted access.
- **OAuth 2.0 with PKCE:** For MCP clients that support OAuth. Dynamic client registration, short-lived sessions.
- **Policy engine:** Per-key rules restrict access to specific agents, tools, and capability levels. A scoped key can be limited to `observe` probes on a single agent.

## Layer 6: Output Sanitization

The scrubber runs on the agent before any data leaves the machine:

- Strips environment variables matching `*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`
- Redacts connection strings (database URLs, Redis URIs)
- Redacts `.env` file contents
- Supports custom regex patterns via agent configuration

Scrubbing is applied to all probe output, including nested JSON fields and log content.

## Layer 7: Pack Signing

Official packs are code-signed during the CI/CD build pipeline:

1. Build produces pack artifacts
2. CI signs each pack with the project's RSA private key
3. Agent verifies signatures before loading any pack
4. Unsigned or tampered packs are rejected by default

To load unsigned packs (development only), set `allowUnsignedPacks: true` in the agent config.

## Layer 8: Agent Attestation

At enrollment and on every reconnection, the agent generates an attestation record:

- OS version and kernel
- SHA-256 hash of the agent binary
- SHA-256 hash of the agent configuration
- List of loaded packs and their versions

The hub stores these records and flags any changes between connections. Attestation drift (unexpected binary or config changes) is surfaced in the dashboard and audit log.

## Layer 9: Audit Trail

Every probe request and response is logged on both the agent and the hub. The audit log is:

- **Append-only:** Entries are never modified or deleted.
- **Hash-chained:** Each entry includes a SHA-256 hash of the previous entry, creating a tamper-evident chain.
- **Complete:** Records the requester identity, target agent, probe name, parameters, result status, duration, and timestamp.

The audit log is queryable via the REST API at `GET /api/v1/audit`.
