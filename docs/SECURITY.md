# Sonde Security Model

## Principle: Defense in Depth

Every hop authenticates both sides. Every payload is signed. Every operation is logged. The agent never runs as root. No pack gets access without explicit user approval.

## Full Chain

```
Claude.ai
  ↓ HTTPS + OAuth/API key + session token
Sonde Hub
  ↓ Validates MCP auth → checks policy → signs probe request
  ↓ WSS + mTLS + payload signature
Sonde Agent
  ↓ Verifies hub signature → checks pack capability ceiling
  ↓ Executes as unprivileged 'sonde' user with group-based access
Target System (read-only)
  ↑ Result scrubbed → signed → returned over mTLS WSS
Sonde Hub
  ↑ Assembles response → returns via MCP SSE
Claude.ai
```

## Layer 1: Agent Installation & System Access

- Dedicated `sonde` system user/group — NEVER root
- Binary drops privileges on startup, refuses to run as root
- Group-based read access per pack:
  - `docker` group → Docker socket
  - `systemd-journal` → journalctl
  - `adm` → /var/log
  - Postgres → read-only db role
- Each pack declares requirements in manifest:
  ```json
  {
    "requires": {
      "groups": ["docker"],
      "commands": ["docker"],
      "files": ["/var/run/docker.sock"]
    }
  }
  ```
- User explicitly approves each permission grant
- Packs enter "pending" state until access granted

## Layer 2: No Raw Shell Execution

- Agent NEVER receives raw shell commands
- Structured probe descriptors only: `{ "probe": "docker.containers.list", "params": { "all": true } }`
- Agent maps descriptors to commands internally
- No code path from MCP to arbitrary execution

## Layer 3: Capability Levels & Ceilings

- **observe** — read-only (DEFAULT)
- **interact** — safe mutations (restart service)
- **manage** — full control, dangerous
- Agent config sets `maxCapability` ceiling
- Cannot load handlers above ceiling — code path doesn't exist at runtime

## Layer 4: Agent ↔ Hub Wire Security

**4a. TLS:** All WebSocket over WSS. Non-negotiable.
**4b. mTLS:** Hub issues client cert during enrollment. Both sides verify every connection.
**4c. Enrollment tokens:** Single-use, 15-minute expiry, burned after cert exchange.
**4d. Payload signing:** Every request/response signed with sender's private key. Tampered messages rejected.

## Layer 5: Hub ↔ MCP Client Security

**5a. Auth:** OAuth 2.0 (SaaS) or API key (self-hosted)
**5b. Sessions:** Short-lived tokens, rotating refresh tokens
**5c. Client allowlisting:** Restrict which MCP client origins allowed
**5d. Per-key policies:** Each API key scoped to specific agents, tools, capability levels

## Layer 6: Output Sanitization

- Scrub all output before it leaves agent
- Strip: `*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`
- Redact connection strings, `.env` contents
- Default regex set + user custom patterns
- Runs BEFORE payload signing

## Layer 7: Signed Pack Definitions

- Official packs code-signed by build pipeline
- Agent verifies signature before loading
- Unsigned packs require explicit opt-in: `allowUnsignedPacks: true`

## Layer 8: Agent Attestation

- First enrollment: fingerprint OS version, binary hash, packs, config
- Hub stores attestation record
- Subsequent connections: re-attest, flag unexpected changes
- Optionally quarantine until user approves

## Layer 9: Audit Trail

- Every request/response logged on agent AND hub
- Tamper-evident append-only hash chain
- Includes: who requested, what probe, which agent, result, timestamp
- Queryable via hub admin interface
