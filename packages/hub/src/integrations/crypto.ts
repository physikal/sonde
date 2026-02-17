import crypto from 'node:crypto';

const SALT = 'sonde-integration-v1';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SCRYPT_COST = 16384;

function deriveKey(apiKey: string): Buffer {
  return crypto.scryptSync(apiKey, SALT, KEY_LENGTH, { N: SCRYPT_COST });
}

export function encrypt(plaintext: string, apiKey: string): string {
  const key = deriveKey(apiKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, encrypted, authTag]).toString('base64');
}

export function decrypt(encrypted: string, apiKey: string): string {
  const key = deriveKey(apiKey);
  const buf = Buffer.from(encrypted, 'base64');

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
