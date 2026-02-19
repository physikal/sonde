import type { SondeDb } from '../../db/index.js';
import type { AuthContext } from '../../engine/policy.js';
import { evaluateAgentAccess, evaluateProbeAccess } from '../../engine/policy.js';
import type { ProbeRouter } from '../../integrations/probe-router.js';

type McpResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
};

const AGENT_SOURCES = ['systemd', 'docker', 'nginx'] as const;

/**
 * Resolves the probe name for a given log source.
 * Nginx dispatches to access or error log based on params.type.
 */
function resolveProbe(
  source: string,
  params?: Record<string, unknown>,
): string {
  switch (source) {
    case 'systemd':
      return 'systemd.journal.query';
    case 'docker':
      return 'docker.logs.tail';
    case 'nginx':
      return params?.type === 'error'
        ? 'nginx.error.log.tail'
        : 'nginx.access.log.tail';
    default:
      throw new Error(`Unknown source: ${source}`);
  }
}

/** Default line counts per source. */
const SOURCE_DEFAULTS: Record<string, Record<string, unknown>> = {
  systemd: { lines: 50 },
  docker: { lines: 100 },
  nginx: { lines: 100 },
};

function mergeDefaults(
  source: string,
  params?: Record<string, unknown>,
): Record<string, unknown> {
  const defaults = SOURCE_DEFAULTS[source] ?? {};
  return { ...defaults, ...params };
}

export async function handleQueryLogs(
  args: {
    source: string;
    agent?: string;
    params?: Record<string, unknown>;
  },
  probeRouter: ProbeRouter,
  db: SondeDb,
  auth?: AuthContext,
  connectedAgents?: string[],
): Promise<McpResult> {
  try {
    if (args.source === 'audit') {
      return handleAuditLogs(args.params, db, auth);
    }

    return await handleAgentLogs(
      args,
      probeRouter,
      db,
      auth,
      connectedAgents,
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
}

function handleAuditLogs(
  params: Record<string, unknown> | undefined,
  db: SondeDb,
  auth?: AuthContext,
): McpResult {
  const opts: {
    agentId?: string;
    apiKeyId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  } = {};

  if (params?.agentId && typeof params.agentId === 'string') {
    opts.agentId = params.agentId;
  }
  if (params?.startDate && typeof params.startDate === 'string') {
    opts.startDate = params.startDate;
  }
  if (params?.endDate && typeof params.endDate === 'string') {
    opts.endDate = params.endDate;
  }
  opts.limit = typeof params?.limit === 'number'
    ? params.limit
    : 50;

  // Scope audit results to the caller's key if it's a scoped key
  if (auth?.keyId && auth.keyId !== 'legacy') {
    opts.apiKeyId = auth.keyId;
  }

  const entries = db.getAuditEntries(opts);
  const output = {
    source: 'audit',
    entries,
    count: entries.length,
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}

async function handleAgentLogs(
  args: {
    source: string;
    agent?: string;
    params?: Record<string, unknown>;
  },
  probeRouter: ProbeRouter,
  db: SondeDb,
  auth?: AuthContext,
  connectedAgents?: string[],
): Promise<McpResult> {
  if (!args.agent) {
    return {
      content: [{
        type: 'text',
        text: `Error: agent is required for ${args.source} logs`,
      }],
      isError: true,
    };
  }

  // Policy: check agent access
  if (auth) {
    const agentDecision = evaluateAgentAccess(auth, args.agent);
    if (!agentDecision.allowed) {
      return {
        content: [{
          type: 'text',
          text: `Access denied: ${agentDecision.reason}`,
        }],
        isError: true,
      };
    }
  }

  // Check agent is online
  if (connectedAgents && !connectedAgents.includes(args.agent)) {
    const agentRow = db.getAgent(args.agent);
    if (!agentRow) {
      return {
        content: [{
          type: 'text',
          text: `Error: Agent "${args.agent}" is not registered with the hub.`,
        }],
        isError: true,
      };
    }
    const lastSeen = agentRow.lastSeen
      ? ` Last seen: ${agentRow.lastSeen}.`
      : '';
    return {
      content: [{
        type: 'text',
        text: `Error: Agent "${args.agent}" is offline.${lastSeen} Check that the agent process is running and can reach the hub.`,
      }],
      isError: true,
    };
  }

  const probeName = resolveProbe(args.source, args.params);

  // Policy: check probe access
  if (auth) {
    const probeDecision = evaluateProbeAccess(
      auth,
      args.agent,
      probeName,
    );
    if (!probeDecision.allowed) {
      return {
        content: [{
          type: 'text',
          text: `Access denied: ${probeDecision.reason}`,
        }],
        isError: true,
      };
    }
  }

  const mergedParams = mergeDefaults(args.source, args.params);
  const start = Date.now();
  const response = await probeRouter.execute(
    probeName,
    mergedParams,
    args.agent,
  );
  const durationMs = Date.now() - start;

  // Audit log
  db.logAudit({
    apiKeyId: auth?.keyId,
    agentId: args.agent,
    probe: probeName,
    status: response.status,
    durationMs: response.durationMs,
    requestJson: JSON.stringify({
      source: args.source,
      agent: args.agent,
      params: mergedParams,
    }),
    responseJson: JSON.stringify(response),
  });

  const output = {
    source: args.source,
    agent: args.agent,
    probe: probeName,
    data: response.data,
    durationMs,
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}
