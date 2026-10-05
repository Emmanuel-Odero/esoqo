import { publicEncrypt, constants } from 'node:crypto';

/**
 * Daraja's B2C `SecurityCredential` — the initiator password RSA-encrypted
 * against Safaricom's own public certificate (PKCS1 v1.5 padding, base64
 * output). This is NOT the same secret as the STK push's Password field
 * (shortcode+passkey+timestamp, base64) — B2C authenticates the *initiator*
 * (a named individual authorised to move money out), not the paybill.
 *
 * The certificate is the Safaricom-published one for the target
 * environment (sandbox vs production carry different certs) — set as
 * MPESA_B2C_CERT, PEM text, not a file path: this runs in a container with
 * no guaranteed writable/readable cert file, and an env var is the same
 * shape every other Daraja secret here already takes.
 */
export function buildSecurityCredential(initiatorPassword: string, certPem: string): string {
  const encrypted = publicEncrypt(
    { key: certPem, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(initiatorPassword, 'utf8'),
  );
  return encrypted.toString('base64');
}
