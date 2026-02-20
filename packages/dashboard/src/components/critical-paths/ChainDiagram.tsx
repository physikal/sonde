import { useState } from 'react';

interface ProbeResult {
  name: string;
  status: 'success' | 'error' | 'timeout';
  durationMs: number;
  data?: unknown;
  error?: string;
}

interface StepResult {
  status: 'pass' | 'fail' | 'partial';
  durationMs: number;
  probes: ProbeResult[];
}

export interface ChainStep {
  id: string;
  stepOrder: number;
  label: string;
  targetType: 'agent' | 'integration';
  targetId: string;
  probes: string[];
  result?: StepResult;
}

interface ChainDiagramProps {
  steps: ChainStep[];
  onStepClick?: (stepId: string) => void;
  onAddStep?: () => void;
  onReorder?: (stepId: string, direction: 'up' | 'down') => void;
  editable?: boolean;
}

const STATUS_BORDER: Record<string, string> = {
  pass: 'border-emerald-500',
  fail: 'border-red-500',
  partial: 'border-amber-500',
};

const STATUS_CONNECTOR: Record<string, string> = {
  pass: 'bg-emerald-500',
  fail: 'bg-red-500',
  partial: 'bg-amber-500',
};

export function ChainDiagram({
  steps,
  onStepClick,
  onAddStep,
  onReorder,
  editable = false,
}: ChainDiagramProps) {
  const [hoveredStep, setHoveredStep] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-y-4">
      {steps.map((step, i) => {
        const borderColor = step.result
          ? STATUS_BORDER[step.result.status] ?? 'border-gray-700'
          : 'border-gray-700';
        const isHovered = hoveredStep === step.id;

        return (
          <div key={step.id} className="flex items-center">
            {/* Step card */}
            <div
              className={`relative w-40 rounded-lg border-2 ${borderColor} bg-gray-900 p-3 transition-colors ${
                onStepClick ? 'cursor-pointer hover:bg-gray-800' : ''
              }`}
              onMouseEnter={() => setHoveredStep(step.id)}
              onMouseLeave={() => setHoveredStep(null)}
              onClick={() => onStepClick?.(step.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onStepClick?.(step.id);
              }}
              role={onStepClick ? 'button' : undefined}
              tabIndex={onStepClick ? 0 : undefined}
            >
              {/* Step number badge */}
              <div className="absolute -top-2.5 left-3 flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-[10px] font-bold text-gray-300">
                {step.stepOrder + 1}
              </div>

              {/* Reorder buttons */}
              {editable && isHovered && onReorder && (
                <div className="absolute -top-2.5 right-2 flex gap-0.5">
                  {i > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReorder(step.id, 'up');
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded bg-gray-700 text-[10px] text-gray-300 hover:bg-gray-600"
                      title="Move left"
                    >
                      &#8592;
                    </button>
                  )}
                  {i < steps.length - 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReorder(step.id, 'down');
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded bg-gray-700 text-[10px] text-gray-300 hover:bg-gray-600"
                      title="Move right"
                    >
                      &#8594;
                    </button>
                  )}
                </div>
              )}

              {/* Label */}
              <p className="mt-1 truncate text-sm font-semibold text-white">
                {step.label}
              </p>

              {/* Target badge */}
              <div className="mt-1 flex items-center gap-1">
                <span
                  className={`rounded px-1 py-0.5 text-[10px] font-medium ${
                    step.targetType === 'agent'
                      ? 'bg-blue-950 text-blue-300'
                      : 'bg-purple-950 text-purple-300'
                  }`}
                >
                  {step.targetType}
                </span>
                <span className="truncate text-[11px] text-gray-400">
                  {step.targetId}
                </span>
              </div>

              {/* Probe count */}
              <p className="mt-1 text-[10px] text-gray-500">
                {step.probes.length} probe{step.probes.length !== 1 ? 's' : ''}
              </p>

              {/* Duration badge when results present */}
              {step.result && (
                <div className="mt-1.5 flex items-center gap-1">
                  <span
                    className={`text-[10px] font-medium ${
                      step.result.status === 'pass'
                        ? 'text-emerald-400'
                        : step.result.status === 'fail'
                          ? 'text-red-400'
                          : 'text-amber-400'
                    }`}
                  >
                    {step.result.status}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {step.result.durationMs}ms
                  </span>
                </div>
              )}
            </div>

            {/* Connector arrow */}
            {i < steps.length - 1 && (
              <div className="flex items-center px-1">
                <div
                  className={`h-0.5 w-6 ${
                    step.result
                      ? STATUS_CONNECTOR[step.result.status] ?? 'bg-gray-600'
                      : 'bg-gray-600'
                  }`}
                />
                <div
                  className={`h-0 w-0 border-y-[4px] border-l-[6px] border-y-transparent ${
                    step.result
                      ? step.result.status === 'pass'
                        ? 'border-l-emerald-500'
                        : step.result.status === 'fail'
                          ? 'border-l-red-500'
                          : 'border-l-amber-500'
                      : 'border-l-gray-600'
                  }`}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* Add step button */}
      {editable && onAddStep && (
        <div className="flex items-center">
          {steps.length > 0 && (
            <div className="flex items-center px-1">
              <div className="h-0.5 w-6 bg-gray-600" />
              <div className="h-0 w-0 border-y-[4px] border-l-[6px] border-y-transparent border-l-gray-600" />
            </div>
          )}
          <button
            type="button"
            onClick={onAddStep}
            className="flex h-24 w-40 items-center justify-center rounded-lg border-2 border-dashed border-gray-700 bg-gray-900/50 text-gray-500 transition-colors hover:border-gray-500 hover:text-gray-300"
          >
            <span className="text-2xl">+</span>
          </button>
        </div>
      )}

      {/* Empty state */}
      {steps.length === 0 && !editable && (
        <p className="text-sm text-gray-500">No steps configured</p>
      )}
    </div>
  );
}
