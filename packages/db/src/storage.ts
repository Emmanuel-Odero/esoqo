import { createHash, randomBytes } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

/**
 * File storage.
 *
 * Upload is the largest attack surface in this application, so every
 * rule is here rather than scattered through route handlers:
 *
 *   1. The declared MIME type is NEVER trusted. Magic bytes decide.
 *   2. The user's filename is NEVER used as a path. Storage keys are
 *      random — no traversal, no collision, no content sniffing from
 *      an extension.
 *   3. Size is capped before the bytes are written.
 *   4. Files are served through an authorised route with
 *      Content-Disposition and X-Content-Type-Options: nosniff, never
 *      as static assets from the app origin.
 *
 * Backed by Cloudflare R2 (S3-compatible) — chosen for its lack of
 * egress fees, which is the one that bites elsewhere. Render's own
 * filesystem is ephemeral and wiped on every restart/deploy, so local
 * disk was never viable beyond local development.
 */

const BUCKET = process.env.R2_BUCKET ?? 'esoko';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  },
  // AWS SDK v3 defaults to sending a CRC32 trailer checksum on every
  // request since ~3.729 — R2's S3-compatible API doesn't support that,
  // and the resulting broken stream surfaces as an opaque SSL handshake
  // failure (alert 40) rather than a clean HTTP error. Only compute a
  // checksum when a command explicitly asks for one.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

export const MAX_BYTES = 10 * 1024 * 1024;

/** Magic-byte signatures. A .png that starts with MZ is an executable. */
const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'application/pdf', ext: 'pdf',
    test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', ext: 'png',
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  // OOXML (docx, xlsx) are ZIP containers — disambiguated below.
  { mime: 'application/zip', ext: 'zip',
    test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07) },
  // Legacy Office compound binary
  { mime: 'application/x-cfb', ext: 'cfb',
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) },
];

export interface SniffResult {
  ok: boolean;
  mime?: string;
  reason?: string;
}

/**
 * Verifies the bytes are what the client claims. Rejects anything whose
 * real type is not on the allow-list, whatever the filename says.
 */
export function sniff(buf: Buffer, declaredMime: string, filename: string): SniffResult {
  if (buf.length === 0) return { ok: false, reason: 'That file is empty' };
  if (buf.length > MAX_BYTES) return { ok: false, reason: 'That file is larger than 10 MB' };

  const hit = SIGNATURES.find((s) => s.test(buf));
  if (!hit) return { ok: false, reason: 'We could not recognise that file type' };

  const ext = filename.toLowerCase().split('.').pop() ?? '';

  if (hit.mime === 'application/zip') {
    // OOXML: the container is a ZIP, so trust the extension only to pick
    // between docx and xlsx — both are already on the allow-list.
    if (ext === 'docx')
      return { ok: true, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    if (ext === 'xlsx')
      return { ok: true, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    return { ok: false, reason: 'Zip archives cannot be uploaded' };
  }

  if (hit.mime === 'application/x-cfb') {
    if (ext === 'doc') return { ok: true, mime: 'application/msword' };
    if (ext === 'xls') return { ok: true, mime: 'application/vnd.ms-excel' };
    return { ok: false, reason: 'We cannot accept that Office format' };
  }

  // The declared type must at least agree with the bytes.
  if (declaredMime && declaredMime !== hit.mime) {
    return { ok: false, reason: 'That file does not match the type it claims to be' };
  }
  return { ok: true, mime: hit.mime };
}

/** Never derived from user input. */
export function makeStorageKey(mime: string): string {
  const ext = {
    'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg',
    'application/msword': 'doc', 'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  }[mime] ?? 'bin';
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/` +
         `${randomBytes(20).toString('hex')}.${ext}`;
}

/** Strips path separators and control characters. Display only. */
export function safeName(filename: string): string {
  return filename.replace(/[/\\?%*:|"<>\x00-\x1f]/g, '_').slice(0, 200) || 'file';
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/* ── storage adapter · Cloudflare R2 ─────────────────────────── */

function assertSafeKey(key: string): void {
  // Defence in depth: the key comes from our own database, but a stored
  // value could still have been poisoned by a bug elsewhere.
  if (key.includes('..') || key.startsWith('/')) throw new Error('Invalid storage key');
}

export async function putObject(key: string, buf: Buffer): Promise<void> {
  assertSafeKey(key);
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buf }));
}

export async function getObject(key: string): Promise<Buffer> {
  assertSafeKey(key);
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  assertSafeKey(key);
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => undefined);
}

export function isPreviewable(mime: string): boolean {
  return mime === 'application/pdf' || mime.startsWith('image/');
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
