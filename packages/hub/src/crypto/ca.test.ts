import forge from 'node-forge';
import { describe, expect, it } from 'vitest';
import { generateCaCert, getCertFingerprint, issueAgentCert, verifyCertAgainstCa } from './ca.js';

describe('CA crypto', () => {
  it('generates a valid CA cert and key in PEM format', () => {
    const ca = generateCaCert();

    expect(ca.certPem).toContain('-----BEGIN CERTIFICATE-----');
    expect(ca.keyPem).toContain('-----BEGIN RSA PRIVATE KEY-----');

    const cert = forge.pki.certificateFromPem(ca.certPem);
    expect(cert.subject.getField('CN')?.value).toBe('sonde-hub-ca');

    // Verify it's a CA cert
    const basicConstraints = cert.getExtension('basicConstraints') as { cA?: boolean } | null;
    expect(basicConstraints?.cA).toBe(true);
  });

  it('issues an agent cert signed by the CA', () => {
    const ca = generateCaCert();
    const agent = issueAgentCert(ca.certPem, ca.keyPem, 'test-agent');

    expect(agent.certPem).toContain('-----BEGIN CERTIFICATE-----');
    expect(agent.keyPem).toContain('-----BEGIN RSA PRIVATE KEY-----');

    const cert = forge.pki.certificateFromPem(agent.certPem);
    expect(cert.subject.getField('CN')?.value).toBe('test-agent');

    // Not a CA
    const basicConstraints = cert.getExtension('basicConstraints') as { cA?: boolean } | null;
    expect(basicConstraints?.cA).toBe(false);

    // Has clientAuth EKU
    const eku = cert.getExtension('extKeyUsage') as { clientAuth?: boolean } | null;
    expect(eku?.clientAuth).toBe(true);
  });

  it('verifies agent cert against CA', () => {
    const ca = generateCaCert();
    const agent = issueAgentCert(ca.certPem, ca.keyPem, 'test-agent');

    expect(verifyCertAgainstCa(agent.certPem, ca.certPem)).toBe(true);
  });

  it('rejects an unrelated cert', () => {
    const ca1 = generateCaCert();
    const ca2 = generateCaCert();
    const agent = issueAgentCert(ca1.certPem, ca1.keyPem, 'test-agent');

    expect(verifyCertAgainstCa(agent.certPem, ca2.certPem)).toBe(false);
  });

  it('produces a stable SHA-256 fingerprint', () => {
    const ca = generateCaCert();
    const agent = issueAgentCert(ca.certPem, ca.keyPem, 'test-agent');

    const fp1 = getCertFingerprint(agent.certPem);
    const fp2 = getCertFingerprint(agent.certPem);

    expect(fp1).toBe(fp2);
    // SHA-256 hex = 64 chars
    expect(fp1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generates unique fingerprints for different certs', () => {
    const ca = generateCaCert();
    const agent1 = issueAgentCert(ca.certPem, ca.keyPem, 'agent-1');
    const agent2 = issueAgentCert(ca.certPem, ca.keyPem, 'agent-2');

    expect(getCertFingerprint(agent1.certPem)).not.toBe(getCertFingerprint(agent2.certPem));
  });
});
