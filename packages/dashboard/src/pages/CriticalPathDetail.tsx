import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../components/common/Toast';
import { ChainDiagram, type ChainStep } from '../components/critical-paths/ChainDiagram';
import { StepEditModal } from '../components/critical-paths/StepEditModal';
import { apiFetch } from '../lib/api';

interface StepRow {
  id: string;
  pathId: string;
  stepOrder: number;
  label: string;
  targetType: 'agent' | 'integration';
  targetId: string;
  probesJson: string;
}

interface CriticalPath {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  steps: StepRow[];
}

interface ExecuteResult {
  path: string;
  description: string;
  overallStatus: 'pass' | 'fail' | 'partial';
  totalDurationMs: number;
  steps: Array<{
    stepOrder: number;
    label: string;
    targetType: string;
    targetId: string;
    status: 'pass' | 'fail' | 'partial';
    durationMs: number;
    probes: Array<{
      name: string;
      status: 'success' | 'error' | 'timeout';
      durationMs: number;
      data?: unknown;
      error?: string;
    }>;
  }>;
}

export function CriticalPathDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [path, setPath] = useState<CriticalPath | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [editResult, setEditResult] = useState<ExecuteResult | null>(null);

  // Editable state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSteps, setEditSteps] = useState<ChainStep[]>([]);
  const [dirty, setDirty] = useState(false);

  // Modal state
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [showAddStep, setShowAddStep] = useState(false);

  // Delete confirmation
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const fetchPath = useCallback(() => {
    if (!id) return;
    setLoading(true);
    apiFetch<CriticalPath>(`/critical-paths/${id}`)
      .then((data) => {
        setPath(data);
        setEditName(data.name);
        setEditDescription(data.description);
        setEditSteps(
          data.steps.map((s) => ({
            id: s.id,
            stepOrder: s.stepOrder,
            label: s.label,
            targetType: s.targetType,
            targetId: s.targetId,
            probes: JSON.parse(s.probesJson) as string[],
          })),
        );
      })
      .catch((err: unknown) => {
        toast(err instanceof Error ? err.message : 'Failed to load critical path', 'error');
      })
      .finally(() => setLoading(false));
  }, [id, toast]);

  useEffect(() => {
    fetchPath();
  }, [fetchPath]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await apiFetch(`/critical-paths/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editName,
          description: editDescription,
          steps: editSteps.map((s) => ({
            label: s.label,
            targetType: s.targetType,
            targetId: s.targetId,
            probes: s.probes,
          })),
        }),
      });
      toast('Critical path saved', 'success');
      setDirty(false);
      fetchPath();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    if (!id) return;
    setRunning(true);
    setEditResult(null);
    try {
      // Save any pending changes first
      if (dirty) {
        await apiFetch(`/critical-paths/${id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: editName,
            description: editDescription,
            steps: editSteps.map((s) => ({
              label: s.label,
              targetType: s.targetType,
              targetId: s.targetId,
              probes: s.probes,
            })),
          }),
        });
        setDirty(false);
      }

      const result = await apiFetch<ExecuteResult>(
        `/critical-paths/${id}/execute`,
        { method: 'POST' },
      );
      setEditResult(result);

      // Overlay results on chain steps
      setEditSteps((prev) =>
        prev.map((step) => {
          const stepResult = result.steps.find(
            (r) => r.stepOrder === step.stepOrder,
          );
          return stepResult
            ? {
                ...step,
                result: {
                  status: stepResult.status,
                  durationMs: stepResult.durationMs,
                  probes: stepResult.probes,
                },
              }
            : step;
        }),
      );

      if (result.overallStatus === 'pass') {
        toast('All steps passed', 'success');
      } else if (result.overallStatus === 'fail') {
        toast('Path check failed', 'error');
      } else {
        toast('Partial failures detected', 'error');
      }
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to execute path', 'error');
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = async () => {
    if (!id || deleteConfirm !== path?.name) return;
    try {
      await apiFetch(`/critical-paths/${id}`, { method: 'DELETE' });
      toast('Critical path deleted', 'success');
      navigate('/critical-paths');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to delete', 'error');
    }
  };

  const handleReorder = (stepId: string, direction: 'up' | 'down') => {
    setEditSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === stepId);
      if (idx === -1) return prev;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;

      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx]!, next[idx]!];
      return next.map((s, i) => ({ ...s, stepOrder: i }));
    });
    setDirty(true);
  };

  const handleStepSave = (stepData: {
    label: string;
    targetType: 'agent' | 'integration';
    targetId: string;
    probes: string[];
  }) => {
    if (editingStepId) {
      setEditSteps((prev) =>
        prev.map((s) =>
          s.id === editingStepId ? { ...s, ...stepData } : s,
        ),
      );
    } else {
      const newId = crypto.randomUUID();
      setEditSteps((prev) => [
        ...prev,
        {
          id: newId,
          stepOrder: prev.length,
          ...stepData,
        },
      ]);
    }
    setEditingStepId(null);
    setShowAddStep(false);
    setDirty(true);
  };

  const handleStepDelete = () => {
    if (!editingStepId) return;
    setEditSteps((prev) =>
      prev
        .filter((s) => s.id !== editingStepId)
        .map((s, i) => ({ ...s, stepOrder: i })),
    );
    setEditingStepId(null);
    setDirty(true);
  };

  const editingStep = editingStepId
    ? editSteps.find((s) => s.id === editingStepId)
    : null;

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  if (!path) {
    return (
      <div className="p-8">
        <p className="text-red-400">Critical path not found</p>
        <button
          type="button"
          onClick={() => navigate('/critical-paths')}
          className="mt-2 rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
        >
          Back to Critical Paths
        </button>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/critical-paths')}
          className="rounded-md bg-gray-800 px-2 py-1 text-sm text-gray-400 hover:bg-gray-700 hover:text-gray-200"
        >
          &larr; Back
        </button>
      </div>

      {/* Name & description */}
      <div className="mt-4 space-y-3">
        <input
          type="text"
          value={editName}
          onChange={(e) => {
            setEditName(e.target.value);
            setDirty(true);
          }}
          className="w-full max-w-md rounded-md border border-gray-700 bg-transparent px-2 py-1 text-2xl font-semibold text-white focus:border-blue-500 focus:outline-none"
        />
        <input
          type="text"
          value={editDescription}
          onChange={(e) => {
            setEditDescription(e.target.value);
            setDirty(true);
          }}
          placeholder="Add a description..."
          className="w-full max-w-lg rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-gray-400 hover:border-gray-700 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={handleRun}
          disabled={running || editSteps.length === 0}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {running ? 'Running...' : 'Run Path'}
        </button>
        {dirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowDelete(true)}
          className="rounded-md bg-red-600/20 px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-600/30"
        >
          Delete
        </button>
      </div>

      {/* Overall result banner */}
      {editResult && (
        <div
          className={`mt-4 rounded-lg border p-3 text-sm ${
            editResult.overallStatus === 'pass'
              ? 'border-emerald-800 bg-emerald-950/30 text-emerald-300'
              : editResult.overallStatus === 'fail'
                ? 'border-red-800 bg-red-950/30 text-red-300'
                : 'border-amber-800 bg-amber-950/30 text-amber-300'
          }`}
        >
          Overall: {editResult.overallStatus} — {editResult.totalDurationMs}ms total
        </div>
      )}

      {/* Chain diagram */}
      <div className="mt-6 overflow-x-auto pb-4">
        <ChainDiagram
          steps={editSteps}
          editable
          onStepClick={(stepId) => setEditingStepId(stepId)}
          onAddStep={() => setShowAddStep(true)}
          onReorder={handleReorder}
        />
      </div>

      {/* Step edit modal */}
      {(editingStepId || showAddStep) && (
        <StepEditModal
          step={
            editingStep
              ? {
                  label: editingStep.label,
                  targetType: editingStep.targetType,
                  targetId: editingStep.targetId,
                  probes: editingStep.probes,
                }
              : null
          }
          onSave={handleStepSave}
          onDelete={editingStepId ? handleStepDelete : undefined}
          onClose={() => {
            setEditingStepId(null);
            setShowAddStep(false);
          }}
        />
      )}

      {/* Delete confirmation */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-xl border border-gray-800 bg-gray-900 p-6">
            <h3 className="text-lg font-semibold text-white">Delete Critical Path</h3>
            <p className="mt-2 text-sm text-gray-400">
              Type <span className="font-mono text-red-400">{path.name}</span> to confirm deletion.
            </p>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={path.name}
              className="mt-3 w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-red-500 focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowDelete(false);
                  setDeleteConfirm('');
                }}
                className="rounded-md bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteConfirm !== path.name}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
