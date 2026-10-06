import { createHash } from 'node:crypto';
import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { encryptPii, decryptPii } from '../crypto';

/**
 * The scanned-ID capture vault — see NationalIdRecord's schema doc
 * comment for why this is separate from Person.nationalIdHash. This
 * phase is manual entry only: front/back photos go through the
 * existing Document pipeline (createDocument in documents.ts), and
 * whoever's capturing (staff today, the person themselves eventually)
 * types what the card says into the fields this file stores. No OCR
 * call happens here — a follow-up wires that in once a provider is
 * chosen, prefilling the same fields this still validates and stores.
 */

export interface SaveNationalIdInput {
  idNumber: string;
  serialNumber?: string;
  sex?: string;
  districtOfBirth?: string;
  dateOfIssue?: Date;
  frontDocumentId?: string;
  backDocumentId?: string;
}

function hashIdNumber(idNumber: string): string {
  return createHash('sha256').update(idNumber.trim()).digest('hex');
}

/** Creates or replaces the record for a party — replacing rather than
 *  versioning, since a person only ever has one current national ID on
 *  file; a re-scan (new card, correction) simply overwrites it. Also
 *  populates Person.nationalIdHash, the platform's existing dedupe
 *  check, which nothing has ever actually written until now. */
export async function saveNationalIdRecord(ctx: Ctx, partyId: string, input: SaveNationalIdInput) {
  requireCapability(ctx, 'document.write', { partyId });
  if (!input.idNumber?.trim()) throw new Error('An ID number is required');

  const idNumberHash = hashIdNumber(input.idNumber);
  const record = await prisma.$transaction(async (tx) => {
    const saved = await tx.nationalIdRecord.upsert({
      where: { partyId },
      create: {
        partyId,
        idNumberEnc: encryptPii(input.idNumber.trim()),
        serialNumberEnc: input.serialNumber ? encryptPii(input.serialNumber.trim()) : undefined,
        sex: input.sex,
        districtOfBirth: input.districtOfBirth,
        dateOfIssue: input.dateOfIssue,
        frontDocumentId: input.frontDocumentId,
        backDocumentId: input.backDocumentId,
      },
      update: {
        idNumberEnc: encryptPii(input.idNumber.trim()),
        serialNumberEnc: input.serialNumber ? encryptPii(input.serialNumber.trim()) : undefined,
        sex: input.sex,
        districtOfBirth: input.districtOfBirth,
        dateOfIssue: input.dateOfIssue,
        frontDocumentId: input.frontDocumentId,
        backDocumentId: input.backDocumentId,
        verifiedAt: null, // a corrected/re-scanned record needs re-confirming
      },
    });
    await tx.person.update({ where: { partyId }, data: { nationalIdHash: idNumberHash } });
    return saved;
  });

  await recordAudit(ctx, {
    action: 'national_id.saved', targetType: 'national_id_record', targetId: partyId,
  });
  return { ...record, idNumberEnc: undefined, serialNumberEnc: undefined };
}

/** Decrypts the record for display — staff review or the person's own
 *  settings page. Every call is audited: decrypting a national ID
 *  number is exactly the kind of action this repo already treats as
 *  audit-worthy (OTP codes and PINs get the same treatment, one-way). */
export async function getDecryptedNationalId(ctx: Ctx, partyId: string) {
  requireCapability(ctx, 'document.read', { partyId });
  const record = await prisma.nationalIdRecord.findUnique({ where: { partyId } });
  if (!record) return null;

  await recordAudit(ctx, {
    action: 'national_id.decrypted', targetType: 'national_id_record', targetId: partyId,
  });

  return {
    partyId: record.partyId,
    idNumber: decryptPii(record.idNumberEnc),
    serialNumber: record.serialNumberEnc ? decryptPii(record.serialNumberEnc) : null,
    sex: record.sex,
    districtOfBirth: record.districtOfBirth,
    dateOfIssue: record.dateOfIssue,
    frontDocumentId: record.frontDocumentId,
    backDocumentId: record.backDocumentId,
    verifiedAt: record.verifiedAt,
  };
}

/**
 * Confirms a NationalIdRecord against the Person's own nationalIdHash
 * and, once they match, finally issues the long-dormant
 * NATIONAL_ID_CONFIRMED attestation — today it's defined in the schema
 * and referenced as static settings-page copy, but nothing has ever
 * actually issued it (see apps/app/.../settings/page.tsx's trust badge).
 */
export async function confirmNationalId(ctx: Ctx, partyId: string) {
  requireCapability(ctx, 'attestation.issue');
  if (!ctx.actorId) throw new Error('Confirming a national ID requires a named staff account');

  const [record, person] = await Promise.all([
    prisma.nationalIdRecord.findUnique({ where: { partyId } }),
    prisma.person.findUnique({ where: { partyId }, select: { nationalIdHash: true } }),
  ]);
  if (!record) throw new Error('No scanned ID on file for this person');
  if (!person?.nationalIdHash || hashIdNumber(decryptPii(record.idNumberEnc)) !== person.nationalIdHash) {
    throw new Error('The scanned ID does not match this person’s record — re-save it first');
  }

  const existing = await prisma.attestation.findFirst({
    where: { subjectId: partyId, claimType: 'NATIONAL_ID_CONFIRMED', revokedAt: null },
  });
  if (existing) return existing;

  const [attestation] = await prisma.$transaction([
    prisma.attestation.create({
      data: {
        subjectId: partyId,
        claimType: 'NATIONAL_ID_CONFIRMED',
        claimValue: { confirmedBy: ctx.actorId },
        issuerUserId: ctx.actorId,
        method: 'DOCUMENT',
        evidenceRefs: [record.frontDocumentId, record.backDocumentId].filter((x): x is string => Boolean(x)),
      },
    }),
    prisma.nationalIdRecord.update({ where: { partyId }, data: { verifiedAt: new Date() } }),
  ]);

  await recordAudit(ctx, {
    action: 'national_id.confirmed', targetType: 'attestation', targetId: attestation.id,
    payload: { partyId },
  });
  return attestation;
}
