import { describe, expect, it } from 'vitest';
import {
  CORE_INSTRUCTIONS,
  buildMcpInstructions,
} from './instructions.js';

function mockDb(prefix?: string) {
  return {
    getHubSetting: (key: string) => {
      if (key === 'mcp_instructions_prefix') return prefix;
      return undefined;
    },
  } as Parameters<typeof buildMcpInstructions>[0];
}

function mockIntegrationManager(
  integrations: Array<{ id: string; type: string; name: string }>,
) {
  return {
    list: () =>
      integrations.map((i) => ({
        ...i,
        status: 'ok',
        lastTestedAt: null,
        lastTestResult: null,
        createdAt: new Date().toISOString(),
      })),
  } as Parameters<typeof buildMcpInstructions>[1];
}

function mockProbeRouter(
  packs: Array<{ name: string; description: string }>,
) {
  return {
    getIntegrationPacks: () =>
      packs.map((p) => ({
        manifest: {
          name: p.name,
          version: '1.0.0',
          description: p.description,
          probes: [],
        },
        handlers: {},
        testConnection: async () => true,
      })),
  } as unknown as Parameters<typeof buildMcpInstructions>[2];
}

describe('buildMcpInstructions', () => {
  it('returns core instructions when no prefix and no integrations', () => {
    const result = buildMcpInstructions(
      mockDb(),
      mockIntegrationManager([]),
      mockProbeRouter([]),
    );

    expect(result).toBe(CORE_INSTRUCTIONS);
  });

  it('prepends custom prefix before core instructions', () => {
    const prefix = 'You are helping the ACME team.';
    const result = buildMcpInstructions(
      mockDb(prefix),
      mockIntegrationManager([]),
      mockProbeRouter([]),
    );

    expect(result).toBe(`${prefix}\n\n${CORE_INSTRUCTIONS}`);
    expect(result.indexOf(prefix)).toBe(0);
  });

  it('trims whitespace-only prefix', () => {
    const result = buildMcpInstructions(
      mockDb('   \n  '),
      mockIntegrationManager([]),
      mockProbeRouter([]),
    );

    expect(result).toBe(CORE_INSTRUCTIONS);
  });

  it('appends active integrations section', () => {
    const result = buildMcpInstructions(
      mockDb(),
      mockIntegrationManager([
        { id: '1', type: 'servicenow', name: 'SNOW Prod' },
        { id: '2', type: 'proxmox', name: 'PVE Cluster' },
      ]),
      mockProbeRouter([
        { name: 'servicenow', description: 'ServiceNow ITSM' },
        { name: 'proxmox', description: 'Proxmox VE hypervisor' },
      ]),
    );

    expect(result).toContain('## Active Integrations');
    expect(result).toContain(
      '- SNOW Prod (servicenow): ServiceNow ITSM',
    );
    expect(result).toContain(
      '- PVE Cluster (proxmox): Proxmox VE hypervisor',
    );
  });

  it('falls back to type name when pack manifest is missing', () => {
    const result = buildMcpInstructions(
      mockDb(),
      mockIntegrationManager([
        { id: '1', type: 'unknown-pack', name: 'Mystery' },
      ]),
      mockProbeRouter([]),
    );

    expect(result).toContain(
      '- Mystery (unknown-pack): unknown-pack',
    );
  });

  it('includes all three parts when prefix and integrations exist', () => {
    const prefix = 'Custom org context.';
    const result = buildMcpInstructions(
      mockDb(prefix),
      mockIntegrationManager([
        { id: '1', type: 'httpbin', name: 'Test API' },
      ]),
      mockProbeRouter([
        { name: 'httpbin', description: 'HTTPBin test API' },
      ]),
    );

    const prefixIdx = result.indexOf(prefix);
    const coreIdx = result.indexOf('# Sonde Infrastructure');
    const intIdx = result.indexOf('## Active Integrations');

    expect(prefixIdx).toBe(0);
    expect(coreIdx).toBeGreaterThan(prefixIdx);
    expect(intIdx).toBeGreaterThan(coreIdx);
  });
});
