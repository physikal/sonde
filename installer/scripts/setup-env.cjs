/**
 * Post-install script: generates sonde-hub.env with SONDE_SECRET.
 * Backs up any existing env file before regenerating.
 *
 * Runs as LocalSystem during MSI install — has write access to ProgramData.
 *
 * Supports two modes:
 * - standalone (default): generates a random SONDE_SECRET locally
 * - keyvault: writes env vars that tell the hub to fetch SONDE_SECRET
 *   from Azure Key Vault at startup
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(
  process.env.PROGRAMDATA || 'C:\\ProgramData',
  'Sonde',
);
const ENV_FILE = path.join(DATA_DIR, 'sonde-hub.env');

/** Parse --key value pairs from process.argv */
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith('--') && i + 1 < argv.length) {
      const name = key.slice(2);
      const value = argv[i + 1];
      args[name] = value;
      i++;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const mode = args['mode'] || 'standalone';

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error(
      `Failed to create data directory: ${DATA_DIR}\n` +
      `  ${err.message}\n` +
      '  Verify the installer is running with administrator privileges.',
    );
    process.exit(1);
  }

  if (fs.existsSync(ENV_FILE)) {
    const backup = `${ENV_FILE}.bak`;
    console.log(`Backing up existing env file to ${backup}`);
    fs.copyFileSync(ENV_FILE, backup);
  }

  let content;

  if (mode === 'keyvault') {
    content = buildKeyVaultEnv(args);
  } else {
    content = buildStandaloneEnv();
  }

  try {
    fs.writeFileSync(ENV_FILE, content, { encoding: 'utf-8' });
  } catch (err) {
    console.error(
      `Failed to write env file: ${ENV_FILE}\n` +
      `  ${err.message}\n` +
      '  Check disk space and directory permissions.',
    );
    process.exit(1);
  }

  console.log(`Created env file: ${ENV_FILE} (mode: ${mode})`);
}

function buildStandaloneEnv() {
  const secret = crypto.randomBytes(32).toString('hex');

  return [
    '# Sonde Hub environment configuration',
    '# Generated during installation — do not delete',
    '#',
    '# SONDE_SECRET is the root encryption key for all hub secrets.',
    '# Back this file up securely. Losing it means re-encrypting all',
    '# stored credentials (integration passwords, SSO client secrets).',
    '',
    `SONDE_SECRET=${secret}`,
    '',
    '# Uncomment and edit as needed:',
    '# PORT=3000',
    '# HOST=0.0.0.0',
    '# SONDE_ADMIN_USER=admin',
    '# SONDE_ADMIN_PASSWORD=changeme',
    '',
  ].join('\r\n');
}

function buildKeyVaultEnv(args) {
  const vaultUrl = args['azure-keyvault-url'] || '';
  const secretName = args['azure-keyvault-secret-name'] || 'sonde-secret';
  const authMethod = args['azure-auth-method'] || 'managed_identity';

  const lines = [
    '# Sonde Hub environment configuration',
    '# Generated during installation — do not delete',
    '#',
    '# SONDE_SECRET is fetched from Azure Key Vault at startup.',
    '# No encryption key is stored on disk.',
    '',
    'SONDE_SECRET_SOURCE=keyvault',
    `AZURE_KEYVAULT_URL=${vaultUrl}`,
    `AZURE_KEYVAULT_SECRET_NAME=${secretName}`,
  ];

  if (authMethod === 'app_registration') {
    const tenantId = args['azure-tenant-id'] || '';
    const clientId = args['azure-client-id'] || '';
    const clientSecret = args['azure-client-secret'] || '';

    lines.push('');
    lines.push('# Azure App Registration credentials');
    lines.push(`AZURE_TENANT_ID=${tenantId}`);
    lines.push(`AZURE_CLIENT_ID=${clientId}`);
    lines.push(`AZURE_CLIENT_SECRET=${clientSecret}`);
  } else {
    lines.push('');
    lines.push('# Using Managed Identity (auto-detected by Azure SDK)');
  }

  lines.push('');
  lines.push('# Uncomment and edit as needed:');
  lines.push('# PORT=3000');
  lines.push('# HOST=0.0.0.0');
  lines.push('# SONDE_ADMIN_USER=admin');
  lines.push('# SONDE_ADMIN_PASSWORD=changeme');
  lines.push('');

  return lines.join('\r\n');
}

main();
