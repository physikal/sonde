---
title: Security Model
---

Sonde implements a defense-in-depth security model designed around a single premise: **agents sit on production infrastructure, so every layer must assume every other layer has been compromised.** The result is a system where no single vulnerability grants an attacker meaningful access.

The core guarantees:

- Agents never listen on a port. All connections are outbound.
- There is no code path from any external input to arbitrary shell execution.
- All probes are read-only. Sonde cannot modify your infrastructure.
- Every message is signed. Every operation is logged. Every secret is encrypted at rest.

---

## Network Architecture

### Outbound-Only Agent Connections

Agents initiate all connections to the hub via WebSocket over TLS. They never bind to a port, never accept inbound connections, and never expose a service on the network.

```
Agent ──WSS──▶ Hub ◀──HTTPS── AI Client (Claude, etc.)
```

**What this mitigates:**

- **Port scanning** — there is nothing to find. An attacker scanning the agent's host discovers zero Sonde-related listening ports.
- **Lateral movement** — compromising a machine on the same network segment gives no path into the agent. There is no service to connect to.
- **Firewall complexity** — agents only need a single outbound HTTPS rule. No inbound firewall rules, no port forwarding, no DMZ configuration.
- **NAT traversal attacks** — agents behind NAT are unreachable from the outside. The WebSocket connection is established outbound and maintained via keep-alive.

### Connection Resilience

If the connection drops, the agent reconnects using exponential backoff (1s → 2s → 4s → ... capped at 60s). During disconnection, the agent holds no state that could be exploited — it simply waits to reconnect.

---

## Agent Execution Model

### No Raw Shell Execution

This is the most important security property of the system. There is **no code path** from any MCP tool call, WebSocket message, or API request to arbitrary shell execution on any agent.

The hub sends structured probe descriptors — typed JSON objects like `{ probe: "system.disk.usage", params: {} }`. The agent maps these to internal handler functions that execute specific, hardcoded commands. An AI client cannot construct a request that escapes this model.

**How it works internally:**

1. Pack handlers are registered at startup. Each handler is a function that takes typed parameters and an `exec` callback.
2. The `exec` callback uses Node.js `execFile` (not `exec`), which does **not spawn a shell**. Arguments are passed as an array, never interpolated into a command string.
3. The handler's command and argument structure are fixed in code. The `params` object can influence things like which filesystem path to check, but it cannot alter which command runs or inject shell metacharacters.

**What this mitigates:**

- **Remote code execution (RCE)** — even if an attacker fully controls the hub or MCP input, they cannot execute arbitrary commands on any agent.
- **Command injection** — `execFile` with array arguments is immune to shell metacharacter injection (`; && | $(...)` etc.). There is no shell to interpret them.
- **Parameter injection** — probe handlers receive typed objects, not raw strings. Each handler validates its own inputs.
- **Privilege escalation via probe abuse** — handlers run fixed commands. You cannot escalate from "read disk usage" to "write a file" or "install a package" because no such code path exists.

### Read-Only Probes

All probes are strictly diagnostic. They collect data (disk usage, container list, service status, log tails) and return structured JSON. There are no mutation operations — no restarts, no config changes, no file writes. This is enforced at the pack design level: the probe handler interface has no mechanism for side effects beyond reading system state.

### Privilege Dropping

The agent refuses to run as root. On startup, it checks `process.getuid()` and exits immediately if it's `0`. This is a hard exit, not a warning.

The agent runs as a dedicated `sonde` system user. Access to system resources is granted through group membership:

| Group | Access |
|-------|--------|
| `docker` | Read container and image info |
| `systemd-journal` | Read journal logs |
| `adm` | Read system logs |
| `postgres` | Read database metrics |

**What this mitigates:**

- **Privilege escalation** — even if a probe handler has a vulnerability, the attacker inherits only the `sonde` user's limited permissions. No root access, no sudo, no capability escalation.
- **Blast radius** — compromise of the agent process gives access to the specific resources granted by group membership, nothing more. An attacker gets read access to Docker info and journal logs, not write access to anything.

---

## WebSocket Security

### Three-Tier Authentication

Every WebSocket connection is authenticated before the upgrade completes. The hub supports three authentication methods, checked in priority order:

1. **mTLS client certificate** — if TLS is enabled and the agent presents a valid client certificate issued by the hub's CA, the connection is accepted. The TLS handshake verifies the certificate chain.
2. **API key** — the agent sends a Bearer token in the `Authorization` header. The hub hashes the token with SHA-256 and looks it up in the database. Raw API keys are never stored.
3. **Enrollment token** — for first-time enrollment only. One-time use, time-limited (see [Enrollment](#enrollment-flow) below).

If none of these pass, the hub responds with `401 Unauthorized` and destroys the socket. No WebSocket upgrade occurs. No partial state is created.

### Agent Identity Binding

After registration, the hub binds the agent's UUID to its WebSocket instance. On every subsequent message, the hub verifies that the `agentId` in the message envelope matches the agent registered on that socket.

**What this mitigates:**

- **Agent impersonation** — an authenticated agent cannot claim to be a different agent. If agent A sends a message with agent B's ID, the hub rejects it and logs a warning.
- **Session hijacking** — even if an attacker captures a valid WebSocket frame, they cannot replay it on a different connection because the agent ID won't match the socket binding.

### Message Size Limits

The WebSocket server enforces a 1 MiB maximum payload size. Messages exceeding this limit are rejected, preventing memory exhaustion attacks.

---

## Enrollment Flow

Agent enrollment is designed to be a one-time, tightly controlled process. The goal: a new agent should authenticate, receive credentials, and start operating — with no window for an attacker to intercept or replay the process.

### How It Works

1. An admin creates an enrollment token in the dashboard. Tokens are single-use and expire after 15 minutes.
2. The agent connects to the hub with the token in the `Authorization` header.
3. The hub validates the token: it must exist, be unused, and not expired.
4. The hub **consumes the token** — marks it as used with a timestamp and the agent's name. It cannot be used again.
5. If the hub's CA is configured, it issues a TLS client certificate for the agent (1-year validity, `clientAuth` only, SHA-256 signed).
6. The hub mints a **scoped API key** (`agent:<name>`) for persistent reconnection. The raw key is returned to the agent; only the SHA-256 hash is stored in the database.
7. The agent saves its certificate, private key, CA cert, and API key to its config directory.
8. On subsequent connections, the agent authenticates via mTLS or its scoped API key — never with the enrollment token again.

**What this mitigates:**

- **Token replay** — tokens are consumed on first use. Even if intercepted, they cannot be reused.
- **Token expiry** — the 15-minute window limits the attack surface for intercepted tokens to minutes, not hours or days.
- **Credential persistence** — the enrollment token is replaced with a scoped API key and (optionally) a TLS certificate. The token is never used again, limiting the blast radius of any single credential.
- **Token enumeration** — active tokens are masked in API listings (only first 8 characters shown). An admin viewing the token list cannot extract full tokens.

### Stable Agent Identity

If an agent re-enrolls with the same name, it receives the same UUID. This means historical probe data, attestation records, and audit logs remain associated with the correct identity. An attacker cannot create a new agent with the same name to "reset" its history.

---

## Payload Signing (RSA-SHA256)

Every message between hub and agent includes an RSA-SHA256 signature over the payload. This provides message integrity independent of the transport layer.

### How It Works

1. The sender serializes the payload to JSON.
2. The sender computes an RSA-SHA256 signature using its private key.
3. The signature is included in the message envelope as a base64 string.
4. The receiver verifies the signature against the sender's known public key (or certificate).
5. If verification fails, the message is rejected.

The hub signs with the CA private key. Agents sign with the private key from their issued TLS certificate. Both sides verify before processing.

**What this mitigates:**

- **Message tampering** — a modified payload fails signature verification. An attacker cannot alter probe requests or responses in transit without detection.
- **Man-in-the-middle modification** — even if TLS were somehow compromised (e.g., a corporate proxy intercepting traffic), payload signatures provide an independent integrity layer. The attacker would need the sender's private key to forge valid signatures.

---

## Output Scrubbing

All probe output is scrubbed on the agent before it leaves the machine. The scrubber deep-walks every field of the response — nested objects, arrays, strings — applying both pattern-based and key-name-based redaction.

### Default Patterns

| Pattern | Example Match | Replacement |
|---------|---------------|-------------|
| Environment variable secrets | `API_KEY=sk-abc123` | `API_KEY=[REDACTED]` |
| Connection strings | `postgres://user:pass@host` | `postgres://user:[REDACTED]@host` |
| Bearer tokens | `Bearer eyJhbGci...` | `Bearer [REDACTED]` |
| Generic API keys | `api_key=a1b2c3d4e5f6...` | `api_key=[REDACTED]` |

### Key-Name Redaction

Any JSON key containing `SECRET`, `KEY`, `TOKEN`, `PASSWORD`, `CREDENTIAL`, or `PRIVATE` (case-insensitive) has its string value replaced with `[REDACTED]`. This catches secrets in structured data that regex patterns might miss.

### Custom Patterns

Agents can define additional regex patterns in their configuration for organization-specific secrets (internal service tokens, proprietary credential formats, etc.).

**What this mitigates:**

- **Secret leakage** — environment variables, connection strings, bearer tokens, and API keys are redacted before leaving the agent. Even if a probe reads a log file containing database credentials, the credentials are stripped.
- **Data exfiltration** — an AI client querying probe results never sees raw secrets. The scrubbed data is what gets signed and transmitted.

Scrubbing runs before payload signing, so the cryptographic signature attests to the scrubbed output — not the raw data.

---

## Encryption at Rest

All sensitive data in the hub's SQLite database is encrypted using AES-256-GCM. This includes integration credentials (ServiceNow passwords, Citrix API keys, etc.), SSO client secrets, and the CA private key.

### Key Derivation

The encryption key is derived from the `SONDE_SECRET` environment variable using scrypt (a memory-hard key derivation function designed to resist brute-force attacks). Each encryption operation uses a random 12-byte IV, ensuring that encrypting the same value twice produces different ciphertext.

AES-256-GCM provides authenticated encryption — it detects both decryption with the wrong key and any tampering with the ciphertext.

**What this mitigates:**

- **Database theft** — if an attacker obtains a copy of the SQLite file, all credentials are encrypted. Without `SONDE_SECRET`, the ciphertext is useless.
- **Ciphertext tampering** — GCM's authentication tag detects any modification to the encrypted data.

---

## Agent Attestation

At enrollment and on every reconnection, the agent generates an attestation record containing:

- OS version, kernel, and architecture
- SHA-256 hash of the agent binary
- SHA-256 hash of the agent configuration (with secrets stripped before hashing)
- List of loaded packs and their versions
- Node.js runtime version

The hub stores these records and compares them on each connection. If any value changes unexpectedly (without a corresponding version update), the agent is marked as `degraded` and the change is logged.

**What this mitigates:**

- **Binary tampering** — if an attacker replaces the agent binary, the SHA-256 hash changes and the hub flags it.
- **Configuration tampering** — unauthorized changes to the agent's config file are detected.
- **Supply chain attacks** — unexpected pack version changes or additions are surfaced.
- **Environment changes** — OS upgrades or kernel changes are recorded, providing a forensic trail.

Legitimate updates (agent version bumps) are handled gracefully — the hub accepts a new attestation baseline when the agent version changes.

---

## Audit Trail

Every probe request and response is logged on both the hub and the agent, creating independent audit trails.

### Hub Audit Log

The hub's audit log is stored in SQLite and is:

- **Append-only** — entries are never modified or deleted.
- **Hash-chained** — each entry includes a SHA-256 hash of the previous entry, creating a tamper-evident chain. Modifying or deleting any entry breaks the chain, which is detectable via the `verifyAuditChain()` function.
- **Complete** — records the requester identity (API key or session), target agent, probe name, parameters, result status, duration, and timestamp.

### Agent Audit Log

The agent maintains an in-memory ring buffer of recent probe executions, also hash-chained. This provides a local forensic record that is independent of the hub — useful if the hub's database is compromised.

### What This Mitigates

- **Log tampering** — the hash chain makes any modification detectable. Changing a single entry invalidates every subsequent hash.
- **Log deletion** — missing entries break the chain at the deletion point.
- **Repudiation** — every probe execution is tied to a specific API key or session, with a timestamp and full request/response record.
- **Forensic gaps** — dual logging (hub + agent) means an attacker would need to compromise both to erase evidence.

The audit log is queryable via the REST API at `GET /api/v1/audit`.

---

## Session and Dashboard Security

### Cookie Security

Dashboard sessions use `httpOnly`, `secure`, and `sameSite=Lax` cookies with 256-bit random session IDs (32 bytes from `crypto.randomBytes`). Sessions expire after 8 hours with a sliding window.

- **httpOnly** — JavaScript cannot access the session cookie, preventing XSS-based session theft.
- **secure** — cookies are only sent over HTTPS.
- **sameSite=Lax** — prevents cross-site request forgery (CSRF) by blocking cookie transmission on cross-origin POST requests.

### Local Authentication

The local admin password (set via `SONDE_ADMIN_PASSWORD` environment variable) is compared using Node.js `crypto.timingSafeEqual`, which prevents timing side-channel attacks that could leak password characters through response time differences.

### Entra ID SSO

SSO authentication uses OpenID Connect with PKCE (Proof Key for Code Exchange):

1. The login redirect includes a `state` parameter (random, 10-minute expiry) to prevent CSRF.
2. A PKCE `code_verifier` is generated and the `code_challenge` (SHA-256 hash) is sent with the authorization request.
3. The callback validates the `state`, exchanges the authorization code with the `code_verifier`, and verifies the `id_token` against Microsoft's JWKS endpoint.
4. Token claims (issuer, audience) are validated to prevent token substitution attacks.

**What this mitigates:**

- **Authorization code interception** — PKCE ensures that even if the authorization code is intercepted, it cannot be exchanged without the code verifier (which is stored in an httpOnly cookie, never in the URL).
- **CSRF on login** — the state parameter prevents an attacker from initiating an OAuth flow that ends in the victim's browser.
- **Token forgery** — ID tokens are verified against Microsoft's public keys with issuer and audience validation.

---

## API Key Security

API keys are the primary authentication mechanism for MCP clients and agents.

### Storage

Raw API keys are never stored. On creation, the key is hashed with SHA-256 and only the hash is saved in the database. The raw key is returned once to the creator and cannot be retrieved again.

### Policy Engine

Each API key can be scoped with policies that restrict which agents, probes, and MCP clients it can access:

```json
{
  "allowedAgents": ["web-server-01", "db-server-01"],
  "allowedProbes": ["system.*", "docker.containers.*"],
  "allowedClients": ["claude-desktop", "cursor"]
}
```

The policy engine evaluates these rules before dispatching any probe request:

- **Agents** — Exact name matching. Only the listed agents can be queried with this key.
- **Probes** — Glob patterns with `*` wildcard (e.g., `system.*` matches all system probes).
- **Clients** — Exact MCP client ID matching. Only the listed clients can use this key.

An empty array (or omitted field) means no restriction on that dimension.

### What This Mitigates

- **Credential theft** — a stolen API key hash is useless for authentication. The attacker needs the raw key.
- **Lateral movement** — a scoped key for one agent cannot query a different agent. Compromise of a single key doesn't grant fleet-wide access.
- **Blast radius** — keys scoped to specific probes limit what data an attacker can access even with a valid key.
- **Client restriction** — keys scoped to specific MCP clients cannot be used from unauthorized tools, limiting misuse of leaked credentials.
- **Revocation** — keys can be revoked immediately via the dashboard. Revoked keys are rejected on the next request.

---

## Certificate Authority and mTLS

When TLS is enabled, the hub runs an internal PKI:

1. On first boot, the hub generates a self-signed CA certificate (RSA, 10-year validity).
2. The CA private key is encrypted with AES-256-GCM and stored in the database.
3. During enrollment, the hub issues agent client certificates (1-year validity) signed by this CA.
4. Agent certificates are constrained: `cA: false`, `clientAuth` only, SHA-256 signed.

On subsequent connections, both sides authenticate — the agent verifies the hub's TLS certificate, and the hub verifies the agent's client certificate against its CA. This is mutual TLS (mTLS).

**What this mitigates:**

- **Hub impersonation** — agents verify the hub's certificate. A rogue hub cannot intercept agent connections without the CA's private key.
- **Agent impersonation at the TLS layer** — only certificates signed by the hub's CA are accepted. An attacker cannot present a self-signed certificate to impersonate an agent.
- **Certificate scope** — agent certs are constrained to `clientAuth` only. They cannot be used to sign other certificates or act as a CA.

---

## Zod Schema Validation

All protocol messages are validated at every boundary using Zod schemas from `@sonde/shared`. Invalid messages are rejected before any processing occurs. This applies to:

- WebSocket message envelopes
- Probe request and response payloads
- Registration payloads
- API request bodies

This provides runtime type safety that prevents malformed data from reaching any handler, eliminating entire classes of deserialization and type confusion vulnerabilities.
