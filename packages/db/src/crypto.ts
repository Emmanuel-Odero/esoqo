import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Reversible encryption for PII that must be readable again — today,
 * only NationalIdRecord.idNumberEnc/serialNumberEnc. Everything else
 * sensitive in this schema (OTP codes, PINs) is one-way hashed, because
 * nothing ever needs it back; a national ID number and serial have to be
 * shown to the person who owns them and to staff doing KYC, which a hash
 * cannot do. This is deliberately the only reversible-PII path in the
 * codebase — do not reach for it for anything a hash would serve.
 *
 * AES-256-GCM: a random 12-byte IV per value (never reused under the
 * same key) and the 16-byte auth tag are stored alongside the
 * ciphertext, all in one Buffer — `iv (12) | tag (16) | ciphertext`.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function encryptionKey(): Buffer {
  const secret = process.env.PII_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('PII_ENCRYPTION_KEY must be set to encrypt or decrypt national ID data');
  }
  // scrypt rather than using the secret directly: derives a fixed
  // 32-byte key regardless of the raw secret's length, the same reason
  // every password-hashing scheme in this codebase never uses a secret
  // as key material verbatim.
  return scryptSync(secret, 'esoqo-pii-v1', 32);
}

// Prisma's generated client types a Bytes column as Uint8Array<ArrayBuffer>,
// a stricter generic than plain Buffer satisfies under newer @types/node —
// so these both traffic in Uint8Array at the boundary, converting to/from
// Buffer only internally where node:crypto needs it.

export function encryptPii(plaintext: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, ciphertext]);
  // A fresh, plain ArrayBuffer-backed copy — Buffer's own .buffer can be a
  // pooled SharedArrayBuffer-typed allocation, which is where the stricter
  // Uint8Array<ArrayBuffer> generic Prisma's Bytes fields expect parts ways.
  const out = new Uint8Array(combined.length);
  out.set(combined);
  return out;
}

export function decryptPii(raw: Uint8Array): string {
  const stored = Buffer.from(raw);
  const iv = stored.subarray(0, IV_LENGTH);
  const tag = stored.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = stored.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
