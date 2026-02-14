import https from 'node:https';
import type tls from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateCaCert, issueAgentCert } from './ca.js';

describe('mTLS handshake', () => {
  const ca = generateCaCert();
  const agent = issueAgentCert(ca.certPem, ca.keyPem, 'test-agent');
  const rogue = generateCaCert();
  const rogueCert = issueAgentCert(rogue.certPem, rogue.keyPem, 'rogue');

  let server: https.Server;
  let port: number;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server = https.createServer(
          {
            cert: ca.certPem,
            key: ca.keyPem,
            ca: [ca.certPem],
            requestCert: true,
            rejectUnauthorized: false,
          },
          (req, res) => {
            const tlsSocket = req.socket as tls.TLSSocket;
            const peerCert = tlsSocket.getPeerCertificate();
            const authorized = tlsSocket.authorized;

            if (authorized && peerCert?.subject) {
              res.writeHead(200);
              res.end(JSON.stringify({ cn: peerCert.subject.CN }));
            } else {
              res.writeHead(403);
              res.end('Forbidden');
            }
          },
        );

        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          port = typeof addr === 'object' && addr ? addr.port : 0;
          resolve();
        });
      }),
  );

  afterAll(() => {
    server.close();
  });

  function httpsRequest(options: https.RequestOptions): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        { hostname: '127.0.0.1', port, path: '/', method: 'GET', ...options },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('accepts a client with a CA-signed cert', async () => {
    const result = await httpsRequest({
      cert: agent.certPem,
      key: agent.keyPem,
      ca: [ca.certPem],
      rejectUnauthorized: false,
    });

    expect(result.status).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.cn).toBe('test-agent');
  });

  it('rejects a client with a cert from an unrecognized CA', async () => {
    const result = await httpsRequest({
      cert: rogueCert.certPem,
      key: rogueCert.keyPem,
      ca: [ca.certPem],
      rejectUnauthorized: false,
    });

    expect(result.status).toBe(403);
  });

  it('handles a client with no cert (falls through to 403)', async () => {
    const result = await httpsRequest({
      ca: [ca.certPem],
      rejectUnauthorized: false,
    });

    expect(result.status).toBe(403);
  });
});
