export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      if (body.error) detail = `: ${body.error}`;
    } catch {
      // response wasn't JSON — use status text
    }
    throw new Error(`${res.status} ${res.statusText}${detail}`);
  }
  return res.json() as Promise<T>;
}
