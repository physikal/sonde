/**
 * Post-install script: generates sonde-hub.env with SONDE_SECRET
 * if the env file does not already exist.
 *
 * Runs as LocalSystem during MSI install — has write access to ProgramData.
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

function main() {
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
    console.log(`Env file already exists: ${ENV_FILE} — skipping.`);
    return;
  }

  const secret = crypto.randomBytes(32).toString('hex');

  const content = [
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

  console.log(`Created env file: ${ENV_FILE}`);
}

main();
