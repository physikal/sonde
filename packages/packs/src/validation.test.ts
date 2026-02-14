import { describe, expect, it } from 'vitest';
import type { Pack } from './types.js';
import { PackValidationError, createPackRegistry, validatePack } from './validation.js';

function makePack(overrides?: Partial<Pack>): Pack {
  return {
    manifest: {
      name: 'test',
      version: '0.1.0',
      description: 'Test pack',
      requires: { groups: [], files: [], commands: [] },
      probes: [
        { name: 'foo', description: 'Foo probe', capability: 'observe', timeout: 10_000 },
        { name: 'bar', description: 'Bar probe', capability: 'observe', timeout: 10_000 },
      ],
    },
    handlers: {
      'test.foo': async () => ({}),
      'test.bar': async () => ({}),
    },
    ...overrides,
  };
}

describe('validatePack', () => {
  it('passes for a valid pack', () => {
    expect(() => validatePack(makePack())).not.toThrow();
  });

  it('throws on missing handler', () => {
    const pack = makePack({
      handlers: {
        'test.foo': async () => ({}),
        // missing test.bar
      },
    });
    expect(() => validatePack(pack)).toThrow(PackValidationError);
    expect(() => validatePack(pack)).toThrow('missing handler for probe "test.bar"');
  });

  it('throws on extra handler', () => {
    const pack = makePack({
      handlers: {
        'test.foo': async () => ({}),
        'test.bar': async () => ({}),
        'test.baz': async () => ({}),
      },
    });
    expect(() => validatePack(pack)).toThrow(PackValidationError);
    expect(() => validatePack(pack)).toThrow('extra handler "test.baz" not in manifest');
  });
});

describe('createPackRegistry', () => {
  it('returns a map of validated packs', () => {
    const pack = makePack();
    const registry = createPackRegistry([pack]);

    expect(registry.size).toBe(1);
    expect(registry.get('test')).toBe(pack);
  });

  it('throws on duplicate pack names', () => {
    const pack1 = makePack();
    const pack2 = makePack();

    expect(() => createPackRegistry([pack1, pack2])).toThrow(PackValidationError);
    expect(() => createPackRegistry([pack1, pack2])).toThrow('Duplicate pack name: "test"');
  });

  it('throws if any pack is invalid', () => {
    const validPack = makePack();
    const invalidPack = makePack({
      manifest: {
        name: 'broken',
        version: '0.1.0',
        description: 'Broken pack',
        requires: { groups: [], files: [], commands: [] },
        probes: [{ name: 'x', description: 'X', capability: 'observe', timeout: 10_000 }],
      },
      handlers: {}, // missing handler
    });

    expect(() => createPackRegistry([validPack, invalidPack])).toThrow(PackValidationError);
  });
});
