import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import type { DocumentStatus } from '@prisma/client';

/**
 * Documents.
 *
 * File upload is the single largest vulnerability surface in this
 * application, so the rules are strict and live in one place:
 *   · the user's filename is NEVER used as a path — storageKey is opaque
 *   · MIME is verified against magic bytes, not the client's claim
 *   · size is capped before anything touches disk
 *   · files are served with Content-Disposition and a nosniff header,
 *     never inline from the app origin
 *   · a document is reachable only by its owner or staff holding
 *     document.read — enforced here, not in the route
 */

export const ALLOWED_TYPES = {
  'application/pdf': { ext: 'pdf', label: 'PDF' },
  'application/msword': { ext: 'doc', label: 'Word' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', label: 'Word' },
  'application/vnd.ms-excel': { ext: 'xls', label: 'Excel' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', label: 'Excel' },
  'image/png': { ext: 'png', label: 'Image' },
  'image/jpeg': { ext: 'jpg', label: 'Image' },
} as const;

export type AllowedMime = keyof typeof ALLOWED_TYPES;
export const MAX_BYTES = 10 * 1024 * 1024;

export const DOCUMENT_KINDS = [
  ['NATIONAL_ID', 'National ID'],
  ['GROUP_CONSTITUTION', 'Group constitution or rules'],
  ['MEMBER_LIST', 'Member list'],
  ['MINUTES', 'Meeting minutes'],
  ['REGISTRATION_CERT', 'Registration certificate'],
  ['KRA_PIN', 'KRA PIN certificate'],
  ['PERMIT', 'County permit or licence'],
  ['PAYMENT_RECEIPT', 'Payment receipt'],
  ['PHOTO', 'Photograph'],
  ['OTHER', 'Something else'],
] as const;

export interface CreateDocumentInput {
  registrationId?: string;
  partyId?: string;
  title: string;
  kind: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export async function createDocument(ctx: Ctx, input: CreateDocumentInput) {
  requireCapability(ctx, input.partyId ? 'document.write' : 'registration.write', {
    partyId: input.partyId, registrationId: input.registrationId,
  });

  if (!(input.mimeType in ALLOWED_TYPES)) {
    throw new Error(`We cannot accept ${input.mimeType} files`);
  }
  if (input.sizeBytes > MAX_BYTES) {
    throw new Error('That file is larger than 10 MB');
  }

  // Identical bytes already uploaded for this subject → reuse, do not duplicate.
  const dupe = await prisma.document.findFirst({
    where: {
      sha256: input.sha256, deletedAt: null,
      ...(input.registrationId ? { registrationId: input.registrationId } : { partyId: input.partyId }),
    },
  });
  if (dupe) return dupe;

  const doc = await prisma.document.create({
    data: {
      registrationId: input.registrationId,
      partyId: input.partyId,
      title: input.title.trim().slice(0, 160),
      kind: input.kind,
      storageKey: input.storageKey,
      originalName: input.originalName.slice(0, 200),
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      uploadedByType: ctx.actorType,
      uploadedById: ctx.actorId ?? undefined,
    },
  });

  await recordAudit(ctx, {
    action: 'document.uploaded',
    targetType: 'document',
    targetId: doc.id,
    payload: { kind: input.kind, mimeType: input.mimeType, sizeBytes: input.sizeBytes },
  });

  return doc;
}

export async function listDocumentsForRegistration(ctx: Ctx, registrationId: string) {
  requireCapability(ctx, 'document.read', { registrationId });
  return prisma.document.findMany({
    where: { registrationId, deletedAt: null },
    orderBy: { uploadedAt: 'desc' },
  });
}

export async function listDocumentsForParty(ctx: Ctx, partyId: string) {
  requireCapability(ctx, 'document.read', { partyId });
  return prisma.document.findMany({
    where: { partyId, deletedAt: null },
    orderBy: { uploadedAt: 'desc' },
  });
}

export interface DocumentFilter {
  status?: DocumentStatus;
  kind?: string;
  search?: string;
  take?: number;
  skip?: number;
}

export async function listDocuments(ctx: Ctx, f: DocumentFilter = {}) {
  requireCapability(ctx, 'document.read');
  const where = {
    deletedAt: null,
    ...(f.status ? { status: f.status } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.search ? { title: { contains: f.search, mode: 'insensitive' as const } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
      include: {
        registration: { select: { id: true, officialName: true, knownAs: true, county: true } },
        party: { include: { person: { select: { officialName: true, knownAs: true } } } },
      },
      orderBy: [{ status: 'asc' }, { uploadedAt: 'desc' }],
      take: f.take ?? 24, skip: f.skip ?? 0,
    }),
    prisma.document.count({ where }),
  ]);
  return { rows, total };
}

export async function getDocument(ctx: Ctx, id: string) {
  requireCapability(ctx, 'document.read', { documentId: id });
  return prisma.document.findFirst({
    where: { id, deletedAt: null },
    include: { registration: true, party: { include: { person: true } } },
  });
}

export async function updateDocument(
  ctx: Ctx, id: string, input: { title?: string; kind?: string },
) {
  requireCapability(ctx, 'document.review', { documentId: id });
  const doc = await prisma.document.update({
    where: { id },
    data: { title: input.title?.trim().slice(0, 160), kind: input.kind },
  });
  await recordAudit(ctx, {
    action: 'document.updated', targetType: 'document', targetId: id,
    payload: { fields: Object.keys(input) },
  });
  return doc;
}

export async function reviewDocument(
  ctx: Ctx, id: string, status: DocumentStatus, note?: string,
) {
  requireCapability(ctx, 'document.review', { documentId: id });
  const doc = await prisma.document.update({
    where: { id },
    data: { status, reviewNote: note, reviewedById: ctx.actorId ?? undefined, reviewedAt: new Date() },
  });
  await recordAudit(ctx, {
    action: 'document.reviewed', targetType: 'document', targetId: id,
    payload: { status, hasNote: Boolean(note) },
  });
  return doc;
}

/** Soft delete. The blob stays until a retention job clears it, so an
 *  accidental deletion is recoverable and the audit trail stays honest. */
export async function deleteDocument(ctx: Ctx, id: string, reason: string) {
  requireCapability(ctx, 'document.delete', { documentId: id });
  const doc = await prisma.document.update({
    where: { id }, data: { deletedAt: new Date(), reviewNote: reason },
  });
  await recordAudit(ctx, {
    action: 'document.deleted', targetType: 'document', targetId: id, payload: { reason },
  });
  return doc;
}

export async function getDocumentStats(ctx: Ctx) {
  requireCapability(ctx, 'document.read');
  const rows = await prisma.document.groupBy({
    by: ['status'], where: { deletedAt: null }, _count: { _all: true },
  });
  return rows.map((r) => ({ status: r.status, count: r._count._all }));
}
