import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

export interface SetupStatus {
  setupComplete: boolean;
  steps: {
    admin_created: boolean;
    api_key_exists: boolean;
    agent_enrolled: boolean;
  };
}

export function useSetupStatus() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    apiFetch<SetupStatus>('/setup/status')
      .then(setStatus)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to fetch setup status');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { status, loading, error, refetch };
}
