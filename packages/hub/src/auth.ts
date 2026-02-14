import type http from 'node:http';

/** Extract API key from Authorization header or query param */
export function extractApiKey(req: http.IncomingMessage): string {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  return url.searchParams.get('apiKey') ?? '';
}
