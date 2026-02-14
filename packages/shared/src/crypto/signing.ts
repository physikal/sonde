import crypto from 'node:crypto';

/**
 * Sign the JSON-serialised payload with an RSA private key.
 * Returns a base64-encoded RSA-SHA256 signature.
 */
export function signPayload(payload: unknown, privateKeyPem: string): string {
  try {
    const data = JSON.stringify(payload);
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(data);
    sign.end();
    return sign.sign(privateKeyPem, 'base64');
  } catch {
    return '';
  }
}

/**
 * Verify an RSA-SHA256 signature over the JSON-serialised payload.
 * Accepts a PEM public key or certificate (Node extracts the public key from certs).
 * Returns false on any error.
 */
export function verifyPayload(
  payload: unknown,
  signature: string,
  publicKeyOrCertPem: string,
): boolean {
  try {
    const data = JSON.stringify(payload);
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(data);
    verify.end();
    return verify.verify(publicKeyOrCertPem, signature, 'base64');
  } catch {
    return false;
  }
}
