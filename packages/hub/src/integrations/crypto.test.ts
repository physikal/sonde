import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './crypto.js';

describe('integration crypto', () => {
  const secret = 'test-secret-key-1234567890';

  it('round-trips plaintext through encrypt/decrypt', () => {
    const plaintext =
      '{"config":{"endpoint":"https://api.example.com"},"credentials":{"apiKey":"secret"}}';
    const encrypted = encrypt(plaintext, secret);
    const decrypted = decrypt(encrypted, secret);

    expect(decrypted).toBe(plaintext);
  });

  it('encrypts empty string', () => {
    const encrypted = encrypt('', secret);
    const decrypted = decrypt(encrypted, secret);

    expect(decrypted).toBe('');
  });

  it('produces different ciphertext with different secrets', () => {
    const plaintext = 'same-plaintext';
    const encrypted1 = encrypt(plaintext, 'key-aaaaaaaaaaaaaaaa');
    const encrypted2 = encrypt(plaintext, 'key-bbbbbbbbbbbbbbbb');

    expect(encrypted1).not.toBe(encrypted2);
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'same-plaintext';
    const encrypted1 = encrypt(plaintext, secret);
    const encrypted2 = encrypt(plaintext, secret);

    expect(encrypted1).not.toBe(encrypted2);
    // Both should still decrypt to the same plaintext
    expect(decrypt(encrypted1, secret)).toBe(plaintext);
    expect(decrypt(encrypted2, secret)).toBe(plaintext);
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt('hello', secret);
    const buf = Buffer.from(encrypted, 'base64');
    // Flip a byte in the ciphertext portion
    buf[14] = (buf[14] ?? 0) ^ 0xff;
    const tampered = buf.toString('base64');

    expect(() => decrypt(tampered, secret)).toThrow();
  });

  it('throws when decrypting with wrong secret', () => {
    const encrypted = encrypt('secret data', secret);

    expect(() => decrypt(encrypted, 'wrong-secret-key-1234567890')).toThrow();
  });
});
