import type { ProbeHandler } from '../../types.js';

export interface ClusterNode {
  nodeId: string;
  name: string;
  votes: number;
  local: boolean;
}

export interface ClusterConfigResult {
  clusterName: string;
  quorate: boolean;
  totalVotes: number;
  expectedVotes: number;
  nodes: ClusterNode[];
  warnings: string[];
}

/**
 * Runs `pvecm status` and parses cluster membership.
 * Output contains sections like:
 *   Cluster information
 *   ~~~~~~~~~~~~~~~~~~
 *   Name:             mycluster
 *   ...
 *   Membership information
 *   ~~~~~~~~~~~~~~~~~~~~~~
 *   Nodeid  Votes Name
 *   1       1     pve01 (local)
 *   2       1     pve02
 */
export const clusterConfig: ProbeHandler = async (_params, exec) => {
  const stdout = await exec('pvecm', ['status']);
  return parseClusterConfig(stdout);
};

export function parseClusterConfig(stdout: string): ClusterConfigResult {
  const lines = stdout.trim().split('\n');
  const warnings: string[] = [];

  let clusterName = '';
  let quorate = false;
  let totalVotes = 0;
  let expectedVotes = 0;
  const nodes: ClusterNode[] = [];

  let inMembership = false;
  let membershipHeaderSeen = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Key: Value pairs in cluster info section
    if (trimmed.startsWith('Name:')) {
      clusterName = trimmed.slice(5).trim();
    }
    if (trimmed.startsWith('Quorate:')) {
      quorate = trimmed.toLowerCase().includes('yes');
    }
    if (trimmed.startsWith('Total votes:')) {
      totalVotes = Number.parseInt(trimmed.slice('Total votes:'.length).trim(), 10) || 0;
    }
    if (trimmed.startsWith('Expected votes:')) {
      expectedVotes = Number.parseInt(trimmed.slice('Expected votes:'.length).trim(), 10) || 0;
    }

    // Membership section detection
    if (trimmed.startsWith('Membership information') || trimmed.startsWith('Nodeid')) {
      inMembership = true;
      if (trimmed.startsWith('Nodeid')) membershipHeaderSeen = true;
      continue;
    }
    if (trimmed.startsWith('~~~')) continue;

    // Parse node lines: "1       1     pve01 (local)"
    if (inMembership && membershipHeaderSeen && trimmed) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        const nodeId = parts[0] ?? '';
        const votes = Number.parseInt(parts[1] ?? '', 10);
        if (Number.isNaN(votes)) continue;

        const nameAndFlags = parts.slice(2).join(' ');
        const local = nameAndFlags.includes('(local)');
        const name = nameAndFlags.replace('(local)', '').trim();

        nodes.push({ nodeId, name, votes, local });
      }
    }
  }

  if (!quorate) {
    warnings.push('Cluster is not quorate');
  }

  return { clusterName, quorate, totalVotes, expectedVotes, nodes, warnings };
}
