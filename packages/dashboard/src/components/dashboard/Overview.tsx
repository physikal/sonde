import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

interface HealthData {
  status: string;
  timestamp: string;
  agents: number;
}

interface IntegrationEventWithName {
  id: number;
  integrationId: string;
  eventType: string;
  status: string | null;
  message: string | null;
  detailJson: string | null;
  createdAt: string;
  integrationName: string;
  integrationType: string;
}

interface AuditEntryWithAgentName {
  id: number;
  timestamp: string;
  apiKeyId: string;
  agentId: string;
  probe: string;
  status: string;
  durationMs: number;
  requestJson: string | null;
  responseJson: string | null;
  agentName: string | null;
}

const TYPE_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  created: { bg: 'bg-emerald-900/50', text: 'text-emerald-400', label: 'Created' },
  config_update: { bg: 'bg-gray-800', text: 'text-gray-400', label: 'Config' },
  credentials_update: { bg: 'bg-gray-800', text: 'text-gray-400', label: 'Credentials' },
  test_connection: { bg: 'bg-blue-900/50', text: 'text-blue-400', label: 'Test' },
  probe_execution: { bg: 'bg-emerald-900/50', text: 'text-emerald-400', label: 'Probe' },
};

const PROBE_STATUS_COLORS: Record<string, string> = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  timeout: 'text-amber-400',
};

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function Overview() {
  const navigate = useNavigate();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [integrationEvents, setIntegrationEvents] = useState<IntegrationEventWithName[]>([]);
  const [agentAudit, setAgentAudit] = useState<AuditEntryWithAgentName[]>([]);
  const [integrationCount, setIntegrationCount] = useState<number | null>(null);

  const fetchHealth = useCallback(() => {
    fetch('/health')
      .then((r) => r.json() as Promise<HealthData>)
      .then((data) => {
        setHealth(data);
        setError(null);
      })
      .catch(() => {
        setHealth(null);
        setError('Unable to reach hub');
      });
  }, []);

  const fetchActivity = useCallback(() => {
    apiFetch<{ events: IntegrationEventWithName[] }>('/activity/integrations?limit=25')
      .then((data) => setIntegrationEvents(data.events))
      .catch(() => {});
    apiFetch<{ entries: AuditEntryWithAgentName[] }>('/activity/agents?limit=25')
      .then((data) => setAgentAudit(data.entries))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchHealth();
    fetchActivity();
    apiFetch<{ integrations: unknown[] }>('/integrations')
      .then((data) => setIntegrationCount(data.integrations.length))
      .catch(() => {});

    const healthInterval = setInterval(fetchHealth, 10_000);
    const activityInterval = setInterval(fetchActivity, 30_000);
    return () => {
      clearInterval(healthInterval);
      clearInterval(activityInterval);
    };
  }, [fetchHealth, fetchActivity]);

  if (error && !health) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-white">Overview</h1>
        <p className="mt-4 text-red-400">{error}</p>
        <button
          type="button"
          onClick={fetchHealth}
          className="mt-2 rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-8">
      <h1 className="text-2xl font-semibold text-white">Overview</h1>

      <div className="mt-6 grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Hub status card */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Hub Status</p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                health?.status === 'ok' ? 'bg-emerald-400' : 'bg-red-400'
              }`}
            />
            <span className="text-lg font-semibold text-white">
              {health?.status === 'ok' ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>

        {/* Connected agents card */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Connected Agents
          </p>
          <p className="mt-2 text-3xl font-bold text-white">{health?.agents ?? '\u2014'}</p>
        </div>

        {/* Active integrations card */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Active Integrations
          </p>
          <p className="mt-2 text-3xl font-bold text-white">{integrationCount ?? '\u2014'}</p>
        </div>
      </div>

      {/* Activity panels */}
      <div className="mt-6 grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Integration activity */}
        <div className="flex min-h-0 flex-col rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="flex shrink-0 items-center gap-2 border-b border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Integration Activity</h2>
            <span className="text-xs text-gray-500">({integrationEvents.length})</span>
          </div>
          {integrationEvents.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">No integration events yet.</p>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {integrationEvents.map((event) => {
                const base = TYPE_BADGES[event.eventType] ?? {
                  bg: 'bg-gray-800',
                  text: 'text-gray-400',
                  label: event.eventType,
                };
                const badge =
                  event.status === 'error' &&
                  (event.eventType === 'test_connection' || event.eventType === 'probe_execution')
                    ? { bg: 'bg-red-900/50', text: 'text-red-400', label: base.label }
                    : base;
                const statusColor = event.status === 'success' ? 'bg-emerald-400' : 'bg-red-400';
                const goToIntegration = () => navigate(`/integrations/${event.integrationId}`);

                return (
                  <button
                    key={event.id}
                    type="button"
                    className="flex w-full items-center gap-3 border-b border-gray-800 px-4 py-2 text-left last:border-b-0 cursor-pointer hover:bg-gray-800/50"
                    onClick={goToIntegration}
                  >
                    <span className="w-14 shrink-0 text-xs text-gray-500">
                      {relativeTime(event.createdAt)}
                    </span>
                    <span className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
                      {event.integrationName}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}
                    >
                      {badge.label}
                    </span>
                    {event.status && (
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusColor}`}
                      />
                    )}
                    <span className="truncate text-sm text-gray-300">{event.message ?? ''}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Agent activity */}
        <div className="flex min-h-0 flex-col rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="flex shrink-0 items-center gap-2 border-b border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Agent Activity</h2>
            <span className="text-xs text-gray-500">({agentAudit.length})</span>
          </div>
          {agentAudit.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">No agent activity yet.</p>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {agentAudit.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="flex w-full items-center gap-3 border-b border-gray-800 px-4 py-2 text-left last:border-b-0 cursor-pointer hover:bg-gray-800/50"
                    onClick={() => navigate(`/agents/${entry.agentId}`)}
                  >
                    <span className="w-14 shrink-0 text-xs text-gray-500">
                      {relativeTime(entry.timestamp)}
                    </span>
                    <span className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
                      {entry.agentName ?? entry.agentId.slice(0, 8)}
                    </span>
                    <span className="shrink-0 text-sm font-medium text-gray-200">
                      {entry.probe}
                    </span>
                    <span
                      className={`shrink-0 text-xs ${PROBE_STATUS_COLORS[entry.status] ?? 'text-gray-400'}`}
                    >
                      {entry.status}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-gray-500">
                      {entry.durationMs}ms
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
