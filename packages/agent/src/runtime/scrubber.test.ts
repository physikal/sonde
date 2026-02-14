import { describe, expect, it } from 'vitest';
import { DEFAULT_SCRUB_PATTERNS, buildPatterns, scrubData } from './scrubber.js';

const patterns = DEFAULT_SCRUB_PATTERNS;

describe('scrubData', () => {
  it('redacts env var secrets like DB_PASSWORD=hunter2', () => {
    const result = scrubData('DB_PASSWORD=hunter2', patterns);
    expect(result).toBe('DB_PASSWORD=[REDACTED]');
  });

  it('redacts connection strings (keeps user and host, redacts password)', () => {
    const input = 'postgresql://admin:s3cret@db.host:5432/mydb';
    const result = scrubData(input, patterns);
    expect(result).toBe('postgresql://admin:[REDACTED]@db.host:5432/mydb');
    expect(result).not.toContain('s3cret');
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig';
    const result = scrubData(input, patterns);
    expect(result).toContain('Bearer [REDACTED]');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('redacts values of sensitive object keys', () => {
    const input = { DB_PASSWORD: 'hunter2', host: 'localhost' };
    const result = scrubData(input, patterns);
    expect(result).toEqual({ DB_PASSWORD: '[REDACTED]', host: 'localhost' });
  });

  it('passes through numbers, booleans, and null unchanged', () => {
    expect(scrubData(42, patterns)).toBe(42);
    expect(scrubData(true, patterns)).toBe(true);
    expect(scrubData(null, patterns)).toBe(null);
    expect(scrubData(undefined, patterns)).toBe(undefined);
  });

  it('handles nested objects and arrays recursively', () => {
    const input = {
      config: {
        secrets: [{ API_KEY: 'abc123xyz', name: 'prod' }, 'SECRET_TOKEN=my-token-value'],
      },
    };
    const result = scrubData(input, patterns) as Record<string, unknown>;
    const config = result.config as Record<string, unknown>;
    const secrets = config.secrets as unknown[];
    expect((secrets[0] as Record<string, unknown>).API_KEY).toBe('[REDACTED]');
    expect((secrets[0] as Record<string, unknown>).name).toBe('prod');
    expect(secrets[1]).toBe('SECRET_TOKEN=[REDACTED]');
  });

  it('redacts generic API key patterns', () => {
    const input = 'api_key=abcdef1234567890xx';
    const result = scrubData(input, patterns);
    expect(result).toBe('api_key=[REDACTED]');
  });

  it('does not modify non-sensitive data', () => {
    const input = { hostname: 'server-1', uptime: 12345, healthy: true };
    const result = scrubData(input, patterns);
    expect(result).toEqual(input);
  });
});

describe('buildPatterns', () => {
  it('includes default patterns when no custom regexes given', () => {
    const result = buildPatterns();
    expect(result.length).toBe(DEFAULT_SCRUB_PATTERNS.length);
  });

  it('adds valid custom regex patterns', () => {
    const result = buildPatterns(['SSN:\\s*\\d{3}-\\d{2}-\\d{4}']);
    expect(result.length).toBe(DEFAULT_SCRUB_PATTERNS.length + 1);

    const scrubbed = scrubData('SSN: 123-45-6789', result);
    expect(scrubbed).toBe('[REDACTED]');
  });

  it('skips invalid custom regexes gracefully', () => {
    const result = buildPatterns(['[invalid-regex']);
    expect(result.length).toBe(DEFAULT_SCRUB_PATTERNS.length);
  });
});
