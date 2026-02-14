import forge from 'node-forge';

export interface CaCert {
  certPem: string;
  keyPem: string;
}

export interface AgentCert {
  certPem: string;
  keyPem: string;
}

/** Generate a self-signed CA certificate (2048-bit RSA, 10yr validity). */
export function generateCaCert(): CaCert {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 10);

  const attrs = [{ name: 'commonName', value: 'sonde-hub-ca' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    {
      name: 'keyUsage',
      keyCertSign: true,
      cRLSign: true,
    },
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

/** Issue a client certificate for an agent, signed by the hub CA. */
export function issueAgentCert(caCertPem: string, caKeyPem: string, agentName: string): AgentCert {
  const caCert = forge.pki.certificateFromPem(caCertPem);
  const caKey = forge.pki.privateKeyFromPem(caKeyPem);

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(16));
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

  cert.setSubject([{ name: 'commonName', value: agentName }]);
  cert.setIssuer(caCert.subject.attributes);

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
    },
    {
      name: 'extKeyUsage',
      clientAuth: true,
    },
  ]);

  cert.sign(caKey, forge.md.sha256.create());

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

/** Get SHA-256 fingerprint of a PEM certificate as lowercase hex. */
export function getCertFingerprint(certPem: string): string {
  const cert = forge.pki.certificateFromPem(certPem);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const md = forge.md.sha256.create();
  md.update(der);
  return md.digest().toHex();
}

/** Verify that a certificate was signed by the given CA. */
export function verifyCertAgainstCa(certPem: string, caCertPem: string): boolean {
  try {
    const cert = forge.pki.certificateFromPem(certPem);
    const caCert = forge.pki.certificateFromPem(caCertPem);
    return caCert.verify(cert);
  } catch {
    return false;
  }
}
