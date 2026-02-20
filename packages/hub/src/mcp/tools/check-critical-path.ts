import type { SondeDb } from '../../db/index.js';
import type { AuthContext } from '../../engine/policy.js';
import type { ProbeRouter } from '../../integrations/probe-router.js';

export async function handleCheckCriticalPath(
  args: { path: string },
  probeRouter: ProbeRouter,
  db: SondeDb,
  auth?: AuthContext,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}> {
  try {
    const pathRow = db.getCriticalPathByName(args.path);
    if (!pathRow) {
      const available = db.listCriticalPaths().map((p) => p.name);
      return {
        content: [
          {
            type: 'text',
            text: `Critical path "${args.path}" not found. Available paths: ${available.length > 0 ? available.join(', ') : 'none configured'}`,
          },
        ],
        isError: true,
      };
    }

    const steps = db.getCriticalPathSteps(pathRow.id);
    if (steps.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `Critical path "${args.path}" has no steps configured.`,
          },
        ],
        isError: true,
      };
    }

    const caller = auth?.keyId ? { apiKeyId: auth.keyId } : undefined;
    const overallStart = Date.now();

    const stepResults = await Promise.allSettled(
      steps.map(async (step) => {
        const probes: string[] = JSON.parse(step.probesJson);
        const stepStart = Date.now();

        const probeResults = await Promise.allSettled(
          probes.map(async (probeName) => {
            const probeStart = Date.now();
            try {
              const agent =
                step.targetType === 'agent' ? step.targetId : undefined;
              const response = await probeRouter.execute(
                probeName,
                undefined,
                agent,
                caller,
              );
              return {
                name: probeName,
                status:
                  response.status === 'success'
                    ? ('success' as const)
                    : ('error' as const),
                durationMs: Date.now() - probeStart,
                data: response.data,
              };
            } catch (error) {
              return {
                name: probeName,
                status: 'error' as const,
                durationMs: Date.now() - probeStart,
                error:
                  error instanceof Error ? error.message : 'Unknown error',
              };
            }
          }),
        );

        const resolvedProbes = probeResults.map((r) =>
          r.status === 'fulfilled'
            ? r.value
            : {
                name: 'unknown',
                status: 'error' as const,
                durationMs: 0,
                error: 'Promise rejected',
              },
        );

        const allPass = resolvedProbes.every(
          (p) => p.status === 'success',
        );
        const allFail = resolvedProbes.every(
          (p) => p.status !== 'success',
        );
        const stepStatus =
          resolvedProbes.length === 0
            ? ('pass' as const)
            : allPass
              ? ('pass' as const)
              : allFail
                ? ('fail' as const)
                : ('partial' as const);

        return {
          stepOrder: step.stepOrder,
          label: step.label,
          targetType: step.targetType,
          targetId: step.targetId,
          status: stepStatus,
          durationMs: Date.now() - stepStart,
          probes: resolvedProbes,
        };
      }),
    );

    const resolvedSteps = stepResults.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : {
            stepOrder: steps[i]!.stepOrder,
            label: steps[i]!.label,
            targetType: steps[i]!.targetType,
            targetId: steps[i]!.targetId,
            status: 'fail' as const,
            durationMs: 0,
            probes: [],
          },
    );

    const allPass = resolvedSteps.every((s) => s.status === 'pass');
    const allFail = resolvedSteps.every((s) => s.status === 'fail');
    const overallStatus = allPass ? 'pass' : allFail ? 'fail' : 'partial';

    const result = {
      path: pathRow.name,
      description: pathRow.description,
      overallStatus,
      totalDurationMs: Date.now() - overallStart,
      steps: resolvedSteps,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        { type: 'text', text: `Error executing critical path: ${message}` },
      ],
      isError: true,
    };
  }
}
