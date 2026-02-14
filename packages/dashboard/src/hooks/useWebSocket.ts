import { useCallback, useEffect, useRef, useState } from 'react';

interface AgentStatus {
  onlineAgentIds: string[];
  onlineAgents: Array<{ id: string; name: string }>;
}

export function useWebSocket() {
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    onlineAgentIds: [],
    onlineAgents: [],
  });
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/dashboard`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string } & AgentStatus;
        if (msg.type === 'agent.status') {
          setAgentStatus({
            onlineAgentIds: msg.onlineAgentIds,
            onlineAgents: msg.onlineAgents,
          });
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Reconnect after 3 seconds
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { agentStatus, connected };
}
