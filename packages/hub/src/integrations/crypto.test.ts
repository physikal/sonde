import { describe, expect, it } from 'vitest';
import { encrypt, decrypt } from './crypto.js';

describe('integration crypto', () => {
  const apiKey = 'test-api-key-1234567890';

  it('round-trips plaintext through encrypt/decrypt', () => {
    const plaintext = '{"config":{"endpoint":"https://api.example.com"},"credentials":{"apiKey":"secret"}}';
    const encrypted = encrypt(plaintext, apiKey);
    const decrypted = decrypt(encrypted, apiKey);

    expect(decrypted).toBe(plaintext);
  });

  it('encrypts empty string', () => {
    const encrypted = encrypt('', apiKey);
    const decrypted = decrypt(encrypted, apiKey);

    expect(decrypted).toBe('');
  });

  it('produces different ciphertext with different API keys', () => {
    const plaintext = 'same-plaintext';
    const encrypted1 = encrypt(plaintext, 'key-aaaaaaaaaaaaaaaa');
    const encrypted2 = encrypt(plaintext, 'key-bbbbbbbbbbbbbbbb');

    expect(encrypted1).not.toBe(encrypted2);
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'same-plaintext';
    const encrypted1 = encrypt(plaintext, apiKey);
    const encrypted2 = encrypt(plaintext, apiKey);

    expect(encrypted1).not.toBe(encrypted2);
    // Both should still decrypt to the same plaintext
    expect(decrypt(encrypted1, apiKey)).toBe(plaintext);
    expect(decrypt(encrypted2, apiKey)).toBe(plaintext);
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt('hello', apiKey);
    const buf = Buffer.from(encrypted, 'base64');
    // Flip a byte in the ciphertext portion
    buf[14] = buf[14]! ^ 0xff;
    const tampered = buf.toString('base64');

    expect(() => decrypt(tampered, apiKey)).toThrow();
  });

  it('throws when decrypting with wrong API key', () => {
    const encrypted = encrypt('secret data', apiKey);

    expect(() => decrypt(encrypted, 'wrong-api-key-1234567890')).toThrow();
  });
});
