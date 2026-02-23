---
title: Hub Configuration
---

All hub configuration is done through environment variables. There are no config files to manage.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SONDE_SECRET` | Yes (local mode) | — | Encryption root of trust (AES-256-GCM) and fallback auth secret. Must be at least 16 characters. Not required when using Key Vault mode — the hub fetches it at startup. |
| `SONDE_SECRET_SOURCE` | No | `local` | Where the hub gets its encryption secret. `local` reads from `SONDE_SECRET` env var. `keyvault` fetches from Azure Key Vault at startup. |
| `SONDE_HUB_URL` | No | — | Public URL of the hub (e.g., `https://mcp.example.com`). Required for SSO callback URLs and agent enrollment. Used in install scripts and enrollment token payloads. |
| `SONDE_ADMIN_USER` | Recommended | — | Username for the bootstrap admin login. Required to access the dashboard and configure SSO, integrations, etc. The hub starts without it, but you won't be able to log in. |
| `SONDE_ADMIN_PASSWORD` | Recommended | — | Password for the bootstrap admin login. Choose a strong value. Must be set together with `SONDE_ADMIN_USER`. |
| `PORT` | No | `3000` | HTTP port the hub listens on. |
| `HOST` | No | `0.0.0.0` | Bind address. Set to `127.0.0.1` to restrict to localhost. |
| `SONDE_DB_PATH` | No | `./sonde.db` | Path to the SQLite database file. In Docker, this defaults to `/data/sonde.db`. On Windows, the MSI installer sets this to `C:\ProgramData\Sonde\sonde.db`. |
| `SONDE_TLS` | No | `false` | Enable TLS/mTLS for agent WebSocket connections. When enabled, the hub acts as a CA and issues certificates to agents during enrollment. |
| `LOG_LEVEL` | No | `info` | Pino log level. One of: `fatal`, `error`, `warn`, `info`, `debug`, `trace`. |
| `NODE_ENV` | No | — | Set to `production` to disable pretty-printed logs (outputs structured JSON instead). |

### Azure Key Vault variables

These are only required when `SONDE_SECRET_SOURCE=keyvault`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `AZURE_KEYVAULT_URL` | Yes | — | Full vault URL (e.g., `https://sonde-vault.vault.azure.net`). |
| `AZURE_KEYVAULT_SECRET_NAME` | No | `sonde-secret` | Name of the secret in Key Vault that holds the encryption key. |
| `AZURE_TENANT_ID` | Only for App Registration | — | Entra tenant ID. Not needed for Managed Identity. |
| `AZURE_CLIENT_ID` | Only for App Registration | — | App registration (service principal) client ID. Not needed for Managed Identity. |
| `AZURE_CLIENT_SECRET` | Only for App Registration | — | App registration client secret. Not needed for Managed Identity. |

:::note
`SONDE_API_KEY` is accepted as a fallback for `SONDE_SECRET` for backward compatibility, but is deprecated. If both are set, `SONDE_SECRET` takes precedence. Migrate to `SONDE_SECRET` — `SONDE_API_KEY` will be removed in a future release.
:::

## Setting variables

**Docker:**

```bash
docker run -d \
  -e SONDE_SECRET=your-secret-key \
  -e SONDE_HUB_URL=https://mcp.example.com \
  -e SONDE_ADMIN_USER=admin \
  -e SONDE_ADMIN_PASSWORD=change-me \
  -e PORT=8080 \
  -p 8080:8080 \
  -v sonde-data:/data \
  ghcr.io/physikal/hub:latest
```

**Docker Compose:**

```yaml
services:
  sonde-hub:
    image: ghcr.io/physikal/hub:latest
    environment:
      SONDE_SECRET: your-secret-key
      SONDE_HUB_URL: https://mcp.example.com
      SONDE_ADMIN_USER: admin
      SONDE_ADMIN_PASSWORD: change-me
      SONDE_DB_PATH: /data/sonde.db
    volumes:
      - hub-data:/data
    ports:
      - '3000:3000'
```

**Bare metal (Linux/macOS):**

```bash
export SONDE_SECRET=your-secret-key
export SONDE_HUB_URL=https://mcp.example.com
export SONDE_ADMIN_USER=admin
export SONDE_ADMIN_PASSWORD=change-me
export SONDE_DB_PATH=/var/lib/sonde/sonde.db
node packages/hub/dist/index.js
```

Or inline:

```bash
SONDE_SECRET=your-secret-key SONDE_DB_PATH=/var/lib/sonde/sonde.db node packages/hub/dist/index.js
```

**Windows (MSI installer):**

The MSI installer writes environment variables to `C:\ProgramData\Sonde\sonde-hub.env`. The Windows service loads this file on startup. You don't set env vars manually — the installer dialogs collect them. See [Windows deployment](/hub/deployment/#windows-msi) for details.

## Secret requirements

The hub secret (`SONDE_SECRET`) is the root of trust for all encryption in Sonde. It is used to:

- Derive AES-256-GCM keys for encrypting integration credentials and SSO client secrets.
- Authenticate MCP client requests (as a fallback when no API keys exist yet).

Choose a strong, random value. For example:

```bash
openssl rand -hex 32
```

API keys are managed via the hub dashboard — there is no hardcoded master key. Agents do not use the secret directly. During enrollment, the hub mints a scoped API key for each agent automatically.

## Azure Key Vault

Instead of storing `SONDE_SECRET` on disk, the hub can fetch it from Azure Key Vault at startup. This is useful for enterprises that require centralized secret management — no encryption key is stored on the host machine.

Set `SONDE_SECRET_SOURCE=keyvault` and provide the vault URL. The hub fetches the secret once at startup and holds it in memory for the lifetime of the process.

### Prerequisites

1. An Azure Key Vault instance
2. A secret stored in the vault (at least 16 characters):

```bash
az keyvault secret set \
  --vault-name sonde-vault \
  --name sonde-secret \
  --value $(openssl rand -hex 32)
```

3. An identity with **Key Vault Secrets User** role (or an access policy granting Secret Get permission)

### Authentication methods

The hub uses the Azure SDK's `DefaultAzureCredential`, which tries multiple authentication methods in order. The two relevant for Sonde deployments:

**Managed Identity** (recommended for Azure-hosted VMs and App Services):

- No credentials to manage — Azure handles authentication automatically.
- Enable a system-assigned managed identity on the VM or App Service.
- Assign the **Key Vault Secrets User** RBAC role to that identity on the vault.
- Set only `SONDE_SECRET_SOURCE`, `AZURE_KEYVAULT_URL`, and optionally `AZURE_KEYVAULT_SECRET_NAME`. No tenant/client/secret env vars needed.

```bash
SONDE_SECRET_SOURCE=keyvault
AZURE_KEYVAULT_URL=https://sonde-vault.vault.azure.net
AZURE_KEYVAULT_SECRET_NAME=sonde-secret
```

**App Registration** (for non-Azure machines, on-premises servers, or VMs without managed identity):

- Create an app registration (service principal) in Entra ID.
- Grant it the **Key Vault Secrets User** RBAC role on the vault.
- Set the tenant, client ID, and client secret as environment variables.

```bash
SONDE_SECRET_SOURCE=keyvault
AZURE_KEYVAULT_URL=https://sonde-vault.vault.azure.net
AZURE_KEYVAULT_SECRET_NAME=sonde-secret
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
```

### Setting up an App Registration

If your host doesn't support Managed Identity, create a service principal:

1. Go to **Entra ID** > **App registrations** > **New registration**
2. Name it something like `sonde-hub-keyvault` (single-tenant is fine)
3. No redirect URI needed — this uses the client credentials flow
4. After creation, note the **Application (client) ID** and **Directory (tenant) ID** from the Overview page
5. Go to **Certificates & secrets** > **New client secret** — copy the secret value immediately (it's shown only once)
6. Go to your **Key Vault** > **Access control (IAM)** > **Add role assignment**
7. Select role **Key Vault Secrets User**, assign it to the app registration

Use those three values as `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET`.

:::tip
If you're also using Entra SSO for Sonde dashboard login, you can reuse the same app registration — just add the OIDC redirect URI to the existing registration. The Key Vault access (client credentials) and SSO login (authorization code flow) use different grant types on the same app.
:::

### Setting up Managed Identity

For Azure VMs:

1. Go to the **Virtual Machine** > **Identity** > **System assigned** tab
2. Set Status to **On** and save
3. Go to your **Key Vault** > **Access control (IAM)** > **Add role assignment**
4. Select role **Key Vault Secrets User**, assign it to the VM's managed identity

For Azure App Services, the process is the same — enable system-assigned identity on the App Service resource.

### Verifying Key Vault access

Test from the host where the hub will run:

```bash
# With App Registration credentials
AZURE_TENANT_ID=... AZURE_CLIENT_ID=... AZURE_CLIENT_SECRET=... \
  az keyvault secret show --vault-name sonde-vault --name sonde-secret

# With Managed Identity (run on the Azure VM)
az login --identity
az keyvault secret show --vault-name sonde-vault --name sonde-secret
```

If the `az` CLI can read the secret, the hub will be able to as well — it uses the same credential chain.

See [Troubleshooting](/troubleshooting/#azure-key-vault) for common error codes and fixes.

## Database

The hub uses SQLite for all persistent state: agents, API keys, audit logs, OAuth clients, sessions, and setup status. The database file is created automatically on first start.

To back up the hub, copy the SQLite file while the hub is stopped, or use SQLite's `.backup` command.

In Docker, mount a volume at `/data` to persist the database across container restarts:

```bash
docker run -v sonde-data:/data ...
```

## TLS / mTLS

When `SONDE_TLS=true`, the hub generates a CA certificate and issues client certificates to agents during enrollment. This provides mutual TLS authentication for agent WebSocket connections.

For most deployments behind a reverse proxy with TLS termination, you can leave this disabled and rely on the proxy for transport encryption.
