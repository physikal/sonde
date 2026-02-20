import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

interface StepData {
  label: string;
  targetType: 'agent' | 'integration';
  targetId: string;
  probes: string[];
}

interface StepEditModalProps {
  step: StepData | null;
  onSave: (step: StepData) => void;
  onDelete?: () => void;
  onClose: () => void;
}

interface Agent {
  id: string;
  name: string;
  status: string;
  packs: Array<{ name: string; version: string }>;
}

interface Pack {
  name: string;
  type: string;
  probes: Array<{ name: string; description: string }>;
}

interface Integration {
  id: string;
  name: string;
  type: string;
  status: string;
}

export function StepEditModal({ step, onSave, onDelete, onClose }: StepEditModalProps) {
  const [label, setLabel] = useState(step?.label ?? '');
  const [targetType, setTargetType] = useState<'agent' | 'integration'>(
    step?.targetType ?? 'agent',
  );
  const [targetId, setTargetId] = useState(step?.targetId ?? '');
  const [selectedProbes, setSelectedProbes] = useState<Set<string>>(
    new Set(step?.probes ?? []),
  );

  const [agents, setAgents] = useState<Agent[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [agentData, intData, packData] = await Promise.all([
        apiFetch<{ agents: Agent[] }>('/agents'),
        apiFetch<{ integrations: Integration[] }>('/integrations'),
        apiFetch<{ packs: Pack[] }>('/packs'),
      ]);
      setAgents(agentData.agents);
      setIntegrations(intData.integrations);
      setPacks(packData.packs);
    } catch {
      // Silently fail — dropdowns will be empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const availableProbes: Array<{ name: string; description: string }> = [];
  if (targetType === 'agent') {
    const agent = agents.find((a) => a.name === targetId || a.id === targetId);
    if (agent) {
      for (const pack of agent.packs) {
        const packDef = packs.find((p) => p.name === pack.name && p.type === 'agent');
        if (packDef) {
          for (const probe of packDef.probes) {
            availableProbes.push({
              name: `${pack.name}.${probe.name}`,
              description: probe.description,
            });
          }
        }
      }
    }
  } else {
    const integration = integrations.find(
      (ig) => ig.id === targetId || ig.name === targetId,
    );
    if (integration) {
      const packDef = packs.find(
        (p) => p.name === integration.type && p.type === 'integration',
      );
      if (packDef) {
        for (const probe of packDef.probes) {
          availableProbes.push({
            name: `${integration.type}.${probe.name}`,
            description: probe.description,
          });
        }
      }
    }
  }

  const toggleProbe = (name: string) => {
    setSelectedProbes((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleSave = () => {
    if (!label.trim() || !targetId) return;
    onSave({
      label: label.trim(),
      targetType,
      targetId,
      probes: [...selectedProbes],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h3 className="text-lg font-semibold text-white">
          {step ? 'Edit Step' : 'Add Step'}
        </h3>

        {loading ? (
          <div className="py-8 text-center text-gray-400">Loading...</div>
        ) : (
          <div className="mt-4 space-y-4">
            {/* Label */}
            <div>
              <label className="text-xs font-medium uppercase text-gray-500">
                Label
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Load Balancer"
                className="mt-1 w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Target type */}
            <div>
              <label className="text-xs font-medium uppercase text-gray-500">
                Target Type
              </label>
              <div className="mt-1 flex gap-2">
                {(['agent', 'integration'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setTargetType(t);
                      setTargetId('');
                      setSelectedProbes(new Set());
                    }}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      targetType === t
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {t === 'agent' ? 'Agent' : 'Integration'}
                  </button>
                ))}
              </div>
            </div>

            {/* Target selector */}
            <div>
              <label className="text-xs font-medium uppercase text-gray-500">
                Target
              </label>
              <select
                value={targetId}
                onChange={(e) => {
                  setTargetId(e.target.value);
                  setSelectedProbes(new Set());
                }}
                className="mt-1 w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="">Select a target...</option>
                {targetType === 'agent'
                  ? agents.map((a) => (
                      <option key={a.id} value={a.name}>
                        {a.name} ({a.status})
                      </option>
                    ))
                  : integrations.map((ig) => (
                      <option key={ig.id} value={ig.id}>
                        {ig.name} ({ig.type})
                      </option>
                    ))}
              </select>
            </div>

            {/* Probe selector */}
            {targetId && (
              <div>
                <label className="text-xs font-medium uppercase text-gray-500">
                  Probes
                </label>
                <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-gray-700 bg-gray-800">
                  {availableProbes.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-gray-500">
                      No probes available for this target
                    </p>
                  ) : (
                    availableProbes.map((probe) => (
                      <label
                        key={probe.name}
                        className="flex items-start gap-2 px-3 py-2 hover:bg-gray-700/50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedProbes.has(probe.name)}
                          onChange={() => toggleProbe(probe.name)}
                          className="mt-0.5 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                        />
                        <div>
                          <p className="text-sm text-white">{probe.name}</p>
                          <p className="text-[11px] text-gray-500">
                            {probe.description}
                          </p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex items-center justify-between">
          <div>
            {onDelete && step && (
              <button
                type="button"
                onClick={onDelete}
                className="rounded-md bg-red-600/20 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-600/30"
              >
                Delete Step
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!label.trim() || !targetId}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {step ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
