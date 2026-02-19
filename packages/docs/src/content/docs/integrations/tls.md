---
title: TLS & Certificates
---

When the hub connects to an integration endpoint over HTTPS, Node.js verifies the server's TLS certificate against its built-in CA trust store. If the certificate isn't signed by a publicly trusted CA, the connection fails. This page explains why that happens and how to handle it in different environments.

## When you'll hit this

Any integration target that uses a self-signed or internal CA certificate will fail with an error like:

```
TypeError: fetch failed
  cause: unable to verify the first certificate (UNABLE_TO_VERIFY_LEAF_SIGNATURE)
```

Common examples:

- **Proxmox VE** — ships with a self-signed cert by default
- **vCenter / ESXi** — uses VMware-generated certs unless replaced
- **Splunk** — self-signed by default on port 8089
- **On-prem ServiceNow** — dev/test instances often use self-signed certs
- **Nutanix Prism** — uses an internal cert by default
- **Any internal service** behind an organization's private CA

Cloud-hosted SaaS APIs (Datadog, PagerDuty, Cloudflare, Jira Cloud) use publicly trusted certs and won't have this issue.

## Option 1: Skip TLS verification

The simplest approach. Tells the hub to accept any certificate from this integration, including self-signed ones.

**When creating an integration:**
Check the **Skip TLS certificate verification** checkbox in the Add Integration form.

**When editing an existing integration:**
Click **Edit** on the Configuration section and check the **Skip TLS certificate verification** checkbox.

This sets `tlsRejectUnauthorized: false` in the integration config. It applies only to that specific integration — other integrations and agent connections are unaffected.

### Security considerations

Skipping verification means the hub won't detect if something is impersonating the target server (MITM). Whether this matters depends on your environment:

**Home lab / trusted network:** The hub and target are on the same LAN or VLAN. The risk of MITM is negligible. Skipping verification is the pragmatic choice — most home lab software ships with self-signed certs and there's no CA infrastructure to replace them with.

**Enterprise / production:** Skipping verification is a reasonable starting point to get the integration working, but consider replacing self-signed certs with ones from your internal CA (see Option 2). For targets on untrusted network segments, verification is more important.

**Air-gapped or isolated networks:** MITM risk is essentially zero. Skip verification freely.

## Option 2: Use proper certificates

If your organization has a private CA (Active Directory Certificate Services, HashiCorp Vault PKI, step-ca, etc.), issue a cert for the target service signed by that CA. Then:

1. Replace the self-signed cert on the target service with the CA-signed one
2. Add your CA's root certificate to the hub's trust store
3. Leave TLS verification enabled (the default)

### Adding a CA to the hub's trust store

**Docker deployments:**
Mount your CA certificate and set the `NODE_EXTRA_CA_CERTS` environment variable:

```yaml
services:
  sonde-hub:
    image: ghcr.io/physikal/hub:latest
    environment:
      NODE_EXTRA_CA_CERTS: /certs/internal-ca.pem
    volumes:
      - ./internal-ca.pem:/certs/internal-ca.pem:ro
```

**Bare metal:**
Export the variable before starting the hub:

```bash
export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/internal-ca.pem
node packages/hub/dist/index.js
```

`NODE_EXTRA_CA_CERTS` is a Node.js built-in that appends your CA to the default trust store. It accepts a single PEM file — bundle multiple CAs by concatenating them into one file.

### Replacing self-signed certs on common targets

**Proxmox VE:**
Place your cert at `/etc/pve/local/pveproxy-ssl.pem` and key at `/etc/pve/local/pveproxy-ssl.key`, then restart `pveproxy`. See the [Proxmox certificate documentation](https://pve.proxmox.com/wiki/Certificate_Management).

**Splunk:**
Update `server.conf` with `serverCert` and `sslRootCAPath` under the `[sslConfig]` stanza.

**vCenter:**
Use the vSphere Certificate Manager (`/usr/lib/vmware-vmca/bin/certificate-manager`) to replace the Machine SSL certificate.

## Option 3: Let's Encrypt (home lab)

If your home lab services are DNS-resolvable (even on a private network), you can use Let's Encrypt with DNS-01 validation to get free, publicly trusted certs. Tools like [acme.sh](https://github.com/acmesh-official/acme.sh) or [Caddy](https://caddyserver.com/) can automate this with Cloudflare, Route53, or other DNS providers.

This gives you the best of both worlds: real certs with no CA infrastructure to manage, and TLS verification stays enabled.

## Troubleshooting

### `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

The server presented a certificate but the hub can't trace it to a trusted root. Either skip verification for that integration or add the CA to `NODE_EXTRA_CA_CERTS`.

### `CERT_HAS_EXPIRED`

The target's certificate has expired. Renew it on the target, or as a workaround, skip verification.

### `ECONNREFUSED`

Not a TLS issue — the target isn't listening on the specified port. Verify the endpoint URL and port.

### `DEPTH_ZERO_SELF_SIGNED_CERT`

The server's certificate is self-signed (not signed by any CA). Skip verification or replace the cert.

### `ERR_TLS_CERT_ALTNAME_INVALID`

The hostname you're connecting to doesn't match any Subject Alternative Name in the certificate. This often happens when connecting by IP address to a cert issued for a hostname, or vice versa. Use the hostname that matches the cert, or skip verification.

## Activity Log

Connection test results — including the full error chain — are now recorded in the Activity Log on each integration's detail page. When debugging TLS issues, expand the failed test event to see the exact error name, message, and cause.
