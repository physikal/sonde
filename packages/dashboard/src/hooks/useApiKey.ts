import { useCallback, useState } from 'react';

const STORAGE_KEY = 'sonde_api_key';

export function useApiKey() {
  const [apiKey, setApiKeyState] = useState<string | null>(() =>
    sessionStorage.getItem(STORAGE_KEY),
  );

  const setApiKey = useCallback((key: string) => {
    sessionStorage.setItem(STORAGE_KEY, key);
    setApiKeyState(key);
  }, []);

  const clearApiKey = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setApiKeyState(null);
  }, []);

  return { apiKey, setApiKey, clearApiKey };
}

export function authFetch<T>(path: string, apiKey: string, options?: RequestInit): Promise<T> {
  return fetch(`/api/v1${path}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    ...options,
  }).then((res) => {
    if (res.status === 401) {
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  });
}
