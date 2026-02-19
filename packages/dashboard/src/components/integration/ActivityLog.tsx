import { useState } from 'react';

interface IntegrationEvent {
  id: number;
  integrationId: string;
  eventType: string;
  status: string | null;
  message: string | null;
  detailJson: string | null;
  createdAt: string;
}

interface ActivityLogProps {
  events: IntegrationEvent[];
}

const TYPE_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  created: { bg: 'bg-emerald-900/50', text: 'text-emerald-400', label: 'Created' },
  config_update: { bg: 'bg-gray-800', text: 'text-gray-400', label: 'Config' },
  credentials_update: { bg: 'bg-gray-800', text: 'text-gray-400', label: 'Credentials' },
  test_connection: { bg: 'bg-blue-900/50', text: 'text-blue-400', label: 'Test' },
  probe_execution: { bg: 'bg-emerald-900/50', text: 'text-emerald-400', label: 'Probe' },
};

function StatusDot({ status }: { status: string | null }) {
  if (!status) return null;
  const color = status === 'success' ? 'bg-emerald-400' : 'bg-red-400';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function TypeBadge({ eventType, status }: { eventType: string; status: string | null }) {
  const base = TYPE_BADGES[eventType] ?? { bg: 'bg-gray-800', text: 'text-gray-400', label: eventType };

  // Override test/probe colors on error
  let badge = base;
  if (status === 'error' && (eventType === 'test_connection' || eventType === 'probe_execution')) {
    badge = { bg: 'bg-red-900/50', text: 'text-red-400', label: base.label };
  }

  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}>
      {badge.label}
    </span>
  );
}

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

function EventRow({ event }: { event: IntegrationEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!event.detailJson;

  let detail: Record<string, unknown> | null = null;
  if (hasDetail) {
    try {
      detail = JSON.parse(event.detailJson!) as Record<string, unknown>;
    } catch {
      detail = null;
    }
  }

  return (
    <div className="border-b border-gray-800 last:border-b-0">
      <div
        className={`flex items-center gap-3 px-3 py-2 ${hasDetail ? 'cursor-pointer hover:bg-gray-800/50' : ''}`}
        onClick={() => hasDetail && setExpanded(!expanded)}
      >
        <span className="w-16 shrink-0 text-xs text-gray-500">{relativeTime(event.createdAt)}</span>
        <TypeBadge eventType={event.eventType} status={event.status} />
        <StatusDot status={event.status} />
        <span className="truncate text-sm text-gray-300">{event.message ?? ''}</span>
        {hasDetail && (
          <span className="ml-auto shrink-0 text-xs text-gray-600">
            {expanded ? '\u25BC' : '\u25B6'}
          </span>
        )}
      </div>
      {expanded && detail && (
        <div className="mx-3 mb-2 rounded bg-gray-950 p-3 font-mono text-xs text-gray-400">
          {Object.entries(detail).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <span className="shrink-0 text-gray-500">{key}:</span>
              <span className="break-all text-gray-300">{String(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ActivityLog({ events }: ActivityLogProps) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="text-xs text-gray-600">{collapsed ? '\u25B6' : '\u25BC'}</span>
        <h2 className="text-lg font-semibold text-white">Activity Log</h2>
        <span className="text-sm text-gray-500">
          ({events.length} event{events.length !== 1 ? 's' : ''})
        </span>
      </button>
      {!collapsed && (
        <div className="mt-3 rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
          {events.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">No events recorded yet.</p>
          ) : (
            events.map((event) => <EventRow key={event.id} event={event} />)
          )}
        </div>
      )}
    </div>
  );
}
