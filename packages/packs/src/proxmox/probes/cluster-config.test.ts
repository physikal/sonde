import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { ClusterConfigResult } from './cluster-config.js';
import { clusterConfig, parseClusterConfig } from './cluster-config.js';

const SAMPLE_OUTPUT = `Cluster information
~~~~~~~~~~~~~~~~~~
Name:             mycluster
Config Version:   3
Transport:        knet
Secure auth:      on

Quorum information
~~~~~~~~~~~~~~~~~~
Date:             Mon Feb 17 10:00:00 2026
Quorum provider:  corosync_votequorum
Nodes:            3
Node ID:          0x00000001
Ring ID:          1.123
Quorate:          Yes

Votequorum information
~~~~~~~~~~~~~~~~~~~~~~
Expected votes:   3
Highest expected: 3
Total votes:      3
Quorum:           2
Flags:            Quorate

Membership information
~~~~~~~~~~~~~~~~~~~~~~
    Nodeid      Votes Name
         1          1 pve01 (local)
         2          1 pve02
         3          1 pve03`;

describe('parseClusterConfig', () => {
  it('extracts cluster name', () => {
    const result = parseClusterConfig(SAMPLE_OUTPUT);
    expect(result.clusterName).toBe('mycluster');
  });

  it('detects quorate status', () => {
    const result = parseClusterConfig(SAMPLE_OUTPUT);
    expect(result.quorate).toBe(true);
  });

  it('extracts vote counts', () => {
    const result = parseClusterConfig(SAMPLE_OUTPUT);
    expect(result.totalVotes).toBe(3);
    expect(result.expectedVotes).toBe(3);
  });

  it('parses membership nodes', () => {
    const result = parseClusterConfig(SAMPLE_OUTPUT);
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0]).toEqual({
      nodeId: '1',
      name: 'pve01',
      votes: 1,
      local: true,
    });
    expect(result.nodes[1]).toEqual({
      nodeId: '2',
      name: 'pve02',
      votes: 1,
      local: false,
    });
  });

  it('no warnings when quorate', () => {
    const result = parseClusterConfig(SAMPLE_OUTPUT);
    expect(result.warnings).toHaveLength(0);
  });

  it('warns when not quorate', () => {
    const notQuorate = SAMPLE_OUTPUT.replace('Quorate:          Yes', 'Quorate:          No');
    const result = parseClusterConfig(notQuorate);
    expect(result.warnings).toContain('Cluster is not quorate');
  });

  it('handles single-node output', () => {
    const singleNode = `Cluster information
~~~~~~~~~~~~~~~~~~
Name:             standalone

Quorum information
~~~~~~~~~~~~~~~~~~
Quorate:          Yes

Votequorum information
~~~~~~~~~~~~~~~~~~~~~~
Expected votes:   1
Total votes:      1

Membership information
~~~~~~~~~~~~~~~~~~~~~~
    Nodeid      Votes Name
         1          1 pve01 (local)`;
    const result = parseClusterConfig(singleNode);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.local).toBe(true);
  });
});

describe('clusterConfig handler', () => {
  it('calls pvecm status and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('pvecm');
      expect(args).toEqual(['status']);
      return SAMPLE_OUTPUT;
    };

    const result = (await clusterConfig(undefined, mockExec)) as ClusterConfigResult;
    expect(result.clusterName).toBe('mycluster');
    expect(result.nodes).toHaveLength(3);
  });
});
