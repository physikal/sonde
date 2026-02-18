import https from 'node:https';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import forge from 'node-forge';
import { buildTlsFetch } from './tls-fetch.js';

function generateSelfSignedCert(): { key: string; cert: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(
    cert.validity.notBefore.getFullYear() + 1,
  );
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  };
}

describe('buildTlsFetch', () => {
  let server: https.Server;
  let serverUrl: string;

  beforeAll(async () => {
    const { key, cert } = generateSelfSignedCert();
    server = https.createServer({ key, cert }, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const p = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(p);
      });
    });
    serverUrl = `https://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('rejects self-signed cert with default config', async () => {
    const fetchFn = buildTlsFetch({ endpoint: serverUrl });
    await expect(fetchFn(serverUrl)).rejects.toThrow();
  });

  it('accepts self-signed cert when tlsRejectUnauthorized=false', async () => {
    const fetchFn = buildTlsFetch({
      endpoint: serverUrl,
      tlsRejectUnauthorized: false,
    });
    const res = await fetchFn(serverUrl);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('passes headers through to the request', async () => {
    const fetchFn = buildTlsFetch({
      endpoint: serverUrl,
      tlsRejectUnauthorized: false,
    });
    const res = await fetchFn(serverUrl, {
      headers: { 'X-Test': 'hello' },
    });
    expect(res.ok).toBe(true);
  });
});
