export interface ScrubPattern {
  name: string;
  pattern: RegExp;
  replacement?: string;
}

/** Key names that indicate sensitive values (case-insensitive match) */
const SENSITIVE_KEY_RE = /(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|PRIVATE)/i;

export const DEFAULT_SCRUB_PATTERNS: ScrubPattern[] = [
  {
    name: 'env-var-secrets',
    pattern: /\b(\w*(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|PRIVATE)\w*)\s*[=:]\s*\S+/gi,
    replacement: '$1=[REDACTED]',
  },
  {
    name: 'connection-strings',
    pattern:
      /((?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/[^:]+:)[^@]+(@)/gi,
    replacement: '$1[REDACTED]$2',
  },
  {
    name: 'bearer-tokens',
    pattern: /(Bearer\s+)\S+/gi,
    replacement: '$1[REDACTED]',
  },
  {
    name: 'generic-api-keys',
    pattern: /(api[_-]?key|access[_-]?token|auth[_-]?token)\s*[=:]\s*["']?[\w\-./+=]{16,}["']?/gi,
    replacement: '$1=[REDACTED]',
  },
];

/**
 * Deep-walk data, applying scrub patterns to all string values.
 * Also redacts values of object keys that match sensitive key names.
 */
export function scrubData(data: unknown, patterns: ScrubPattern[]): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === 'boolean' || typeof data === 'number') return data;

  if (typeof data === 'string') {
    return scrubString(data, patterns);
  }

  if (Array.isArray(data)) {
    return data.map((item) => scrubData(item, patterns));
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(key) && typeof value === 'string') {
        result[key] = '[REDACTED]';
      } else {
        result[key] = scrubData(value, patterns);
      }
    }
    return result;
  }

  return data;
}

function scrubString(str: string, patterns: ScrubPattern[]): string {
  let result = str;
  for (const p of patterns) {
    // Reset lastIndex for global regexes
    p.pattern.lastIndex = 0;
    result = result.replace(p.pattern, p.replacement ?? '[REDACTED]');
  }
  return result;
}

/**
 * Build scrub patterns from defaults + optional custom regex strings.
 * Invalid custom regexes are silently skipped.
 */
export function buildPatterns(customRegexes?: string[]): ScrubPattern[] {
  const patterns = [...DEFAULT_SCRUB_PATTERNS];

  if (customRegexes) {
    for (const raw of customRegexes) {
      try {
        patterns.push({
          name: `custom:${raw}`,
          pattern: new RegExp(raw, 'gi'),
        });
      } catch {
        // Invalid regex — skip gracefully
      }
    }
  }

  return patterns;
}
