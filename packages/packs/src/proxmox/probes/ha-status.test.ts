import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { HaStatusResult } from './ha-status.js';
import { haStatus, parseHaStatus } from './ha-status.js';

const SAMPLE_OUTPUT = `quorum OK
master pve01 (192.168.1.1, 9dab1c9a)
vm:100 started pve01 none
vm:101 started pve02 none
ct:200 started pve01 none`;

describe('parseHaStatus', () => {
  it('parses HA resource entries', () => {
    const result = parseHaStatus(SAMPLE_OUTPUT);
    expect(result.resources).toHaveLength(3);
    expect(result.resources[0]).toEqual({
      sid: 'vm:100',
      state: 'started',
      node: 'pve01',
      request: 'none',
    });
    expect(result.resources[2]).toEqual({
      sid: 'ct:200',
      state: 'started',
      node: 'pve01',
      request: 'none',
    });
  });

  it('flags error state', () => {
    const output = `quorum OK
vm:100 error pve01 none`;
    const result = parseHaStatus(output);
    expect(result.warnings).toContain('HA resource vm:100 in error state on pve01');
  });

  it('flags fence state', () => {
    const output = `quorum OK
vm:101 fence pve02 none`;
    const result = parseHaStatus(output);
    expect(result.warnings).toContain('HA resource vm:101 in fence state on pve02');
  });

  it('flags stopped resources', () => {
    const output = `quorum OK
vm:100 stopped pve01 none`;
    const result = parseHaStatus(output);
    expect(result.warnings).toContain('HA resource vm:100 is stopped');
  });

  it('returns empty for no resources', () => {
    const result = parseHaStatus('quorum OK');
    expect(result.resources).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('skips master/quorum lines', () => {
    const result = parseHaStatus(SAMPLE_OUTPUT);
    const sids = result.resources.map((r) => r.sid);
    expect(sids).not.toContain('quorum');
    expect(sids).not.toContain('master');
  });
});

describe('haStatus handler', () => {
  it('calls ha-manager status and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('ha-manager');
      expect(args).toEqual(['status']);
      return SAMPLE_OUTPUT;
    };

    const result = (await haStatus(undefined, mockExec)) as HaStatusResult;
    expect(result.resources).toHaveLength(3);
  });
});
