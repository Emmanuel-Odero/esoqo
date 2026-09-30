import {
  mintEsoqoCode, generateSystemHandle, generateHandleCandidates, isSystemHandleShape,
} from '@esoqo/domain';
import type { MemberRole } from '@prisma/client';
import { prisma } from '../client';
import { requireCapability, AuthorisationError, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';

/**
 * Esoqo Payment ID and the derived Group Credit Insight snapshot.
 *
 * See docs/proposals/esoqo-group-treasury-and-payment-id.md §5 and the
 * GroupCreditInsightSnapshot model doc comment for the reasoning. Two
 * rules that matter:
 *
 *   · The ID reuses Attestation, the platform's existing trust
 *     primitive — it does not invent a second verification path.
 *   · A snapshot is computed fresh each time it's requested, from
 *     events this schema already produces. It is never a live-updating
 *     score column, for the same reason a balance is never stored.
 */

export class PaymentIdError extends Error {
  constructor(
    msg: string,
    public readonly code: 'NOT_VERIFIED' | 'ALREADY_ISSUED' | 'HANDLE_TAKEN' | 'NOT_APPROVED',
  ) {
    super(msg);
    this.name = 'PaymentIdError';
  }
}

/**
 * Allocates a code, treating the unique constraint as the only source
 * of truth.
 *
 * This used to pre-check for a clash and retry, which is the shape
 * core-go's retryUnique does too — but a check-then-insert leaves a
 * window between the two statements in which a concurrent minter can
 * take the code, and the loser then surfaces a raw P2002 to the user.
 * Letting the database arbitrate and re-rolling only on 23505 closes
 * the window. Five attempts against ~8.9×10^8 shapes is not a
 * meaningful limit; running out means something is badly wrong.
 */
export async function allocateEsoqoCode(partyId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = mintEsoqoCode();
    try {
      return (await prisma.esoqoPaymentId.create({ data: { partyId, code } })).code;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new PaymentIdError('Could not allocate a Payment ID — try again', 'ALREADY_ISSUED');
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null
    && 'code' in err && (err as { code?: unknown }).code === 'P2002';
}

/**
 * Allocates a free, human-friendly esoqo ID built from a person's own
 * names — the replacement for allocateEsoqoCode's opaque ESK- shape.
 * Same retry-on-P2002 shape: the database is the only arbiter of
 * uniqueness, so a clash just re-rolls rather than being pre-checked.
 *
 * `names` should be the 2-3 official names captured at registration
 * (firstName/middleName/surname). A person with none on file (older
 * data, or a record that only ever had a freeform officialName) falls
 * back to that string's words, so this never has nothing to work with.
 */
export async function allocateEsoqoHandle(partyId: string, names: string[]): Promise<string> {
  const usable = names.filter((n) => n?.trim());
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateSystemHandle(usable);
    try {
      return (await prisma.esoqoPaymentId.create({
        data: { partyId, code, source: 'SYSTEM_GENERATED' },
      })).code;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new PaymentIdError('Could not allocate an esoqo ID — try again', 'ALREADY_ISSUED');
}

/** Issues a Payment ID once the subject holds MSISDN_VERIFIED — the
 *  same verification the sign-in/registration flow already produces.
 *
 *  Person-only by construction: the attestation it requires is a claim
 *  about a phone number, and an ORGANISATION has none. A business's ID
 *  is issued by issueBusinessEsoqoPaymentId instead, on the strength of
 *  an officer's membership rather than the org's own phone. */
export async function issueEsoqoPaymentId(ctx: Ctx) {
  requireCapability(ctx, 'paymentid.issue', { partyId: ctx.partyId });
  if (!ctx.partyId) throw new Error('Sign in required');

  const existing = await prisma.esoqoPaymentId.findUnique({ where: { partyId: ctx.partyId } });
  if (existing) return existing;

  const verified = await prisma.attestation.findFirst({
    where: { subjectId: ctx.partyId, claimType: 'MSISDN_VERIFIED', revokedAt: null },
  });
  if (!verified) {
    throw new PaymentIdError('Verify your phone number before activating a Payment ID', 'NOT_VERIFIED');
  }

  const names = await namesForPerson(ctx.partyId);
  const code = await allocateEsoqoHandle(ctx.partyId, names);
  await recordAudit(ctx, {
    action: 'paymentid.issued', targetType: 'esoko_payment_id', targetId: ctx.partyId,
    payload: { code },
  });
  return prisma.esoqoPaymentId.findUniqueOrThrow({ where: { partyId: ctx.partyId } });
}

/**
 * The read half of the interactive "pick your esoqo ID" step: same
 * MSISDN_VERIFIED gate as issueEsoqoPaymentId, but instead of minting
 * one handle immediately it returns a few candidates for the person to
 * choose from (see confirmMyEsoqoHandle). Returns the existing ID
 * untouched if one is already active — there's nothing to pick then.
 */
export async function previewMyEsoqoHandleCandidates(ctx: Ctx) {
  requireCapability(ctx, 'paymentid.issue', { partyId: ctx.partyId });
  if (!ctx.partyId) throw new Error('Sign in required');

  const existing = await prisma.esoqoPaymentId.findUnique({ where: { partyId: ctx.partyId } });
  if (existing) return { existing, candidates: [] as string[] };

  const verified = await prisma.attestation.findFirst({
    where: { subjectId: ctx.partyId, claimType: 'MSISDN_VERIFIED', revokedAt: null },
  });
  if (!verified) {
    throw new PaymentIdError('Verify your phone number before activating a Payment ID', 'NOT_VERIFIED');
  }

  const names = await namesForPerson(ctx.partyId);
  return { existing: null, candidates: generateHandleCandidates(names) };
}

/**
 * Reserves whichever candidate previewMyEsoqoHandleCandidates showed the
 * person. Re-checks the same verification gate (nothing stops a client
 * from calling this without previewing first) and re-validates the
 * shape, so this never inserts a string a client made up. If someone
 * else took that exact handle in the gap between preview and confirm,
 * this throws HANDLE_TAKEN rather than silently substituting a
 * different one — the whole point of the picker is that the person
 * chose this one.
 */
export async function confirmMyEsoqoHandle(ctx: Ctx, chosenHandle: string) {
  requireCapability(ctx, 'paymentid.issue', { partyId: ctx.partyId });
  if (!ctx.partyId) throw new Error('Sign in required');

  const existing = await prisma.esoqoPaymentId.findUnique({ where: { partyId: ctx.partyId } });
  if (existing) return existing;

  const verified = await prisma.attestation.findFirst({
    where: { subjectId: ctx.partyId, claimType: 'MSISDN_VERIFIED', revokedAt: null },
  });
  if (!verified) {
    throw new PaymentIdError('Verify your phone number before activating a Payment ID', 'NOT_VERIFIED');
  }

  const code = chosenHandle.trim().toLowerCase();
  if (!isSystemHandleShape(code)) {
    throw new PaymentIdError('That is not a valid esoqo ID', 'HANDLE_TAKEN');
  }

  try {
    await prisma.esoqoPaymentId.create({ data: { partyId: ctx.partyId, code, source: 'SYSTEM_GENERATED' } });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    throw new PaymentIdError('Someone just took that esoqo ID — pick another', 'HANDLE_TAKEN');
  }

  await recordAudit(ctx, {
    action: 'paymentid.issued', targetType: 'esoko_payment_id', targetId: ctx.partyId,
    payload: { code },
  });
  return prisma.esoqoPaymentId.findUniqueOrThrow({ where: { partyId: ctx.partyId } });
}

/** The 2-3 names a person's handle draws from — split fields when
 *  present, falling back to splitting the freeform officialName for
 *  older records that predate the split. */
async function namesForPerson(partyId: string): Promise<string[]> {
  const person = await prisma.person.findUnique({
    where: { partyId },
    select: { firstName: true, middleName: true, surname: true, officialName: true },
  });
  return person?.firstName
    ? [person.firstName, person.middleName, person.surname].filter((n): n is string => Boolean(n))
    : (person?.officialName ?? '').split(/\s+/).filter(Boolean);
}

export async function getMyPaymentId(ctx: Ctx) {
  if (!ctx.partyId) return null;
  requireCapability(ctx, 'entity.read', { partyId: ctx.partyId });
  const existing = await prisma.esoqoPaymentId.findUnique({ where: { partyId: ctx.partyId } });
  if (!existing) return null;

  // Lazy renewal check — see reclaimExpiredHandleIfNeeded's doc comment:
  // nothing here runs on a schedule, so an expired premium handle past
  // its grace window is only ever replaced on the next read like this one.
  const { reclaimExpiredHandleIfNeeded } = await import('./esoqo-id-purchase');
  const reclaimed = await reclaimExpiredHandleIfNeeded(ctx, existing, await namesForPerson(ctx.partyId));
  if (reclaimed) return prisma.esoqoPaymentId.findUnique({ where: { partyId: ctx.partyId } });
  return existing;
}

/* ── Business payment IDs ────────────────────────────────────
 *
 * A business is what customers pay, so it needs a Payment ID of its
 * own — and it can never hold the MSISDN_VERIFIED attestation that
 * issueEsoqoPaymentId requires, because an ORGANISATION has no phone
 * number. The trust question is not "is this organisation verified" but
 * "is this person one of its owners", which is already answered by
 * Membership. So the authorisation here is membership-shaped rather
 * than attestation-shaped, deliberately.
 */

const BUSINESS_OFFICER_ROLES: MemberRole[] = ['CHAIRPERSON', 'TREASURER', 'SECRETARY'];

/** The person a business registered under: registration.ts records them
 *  as role OTHER + customRole 'Owner' rather than inventing a new enum
 *  member, so the label has to be matched — case- and
 *  whitespace-tolerantly, because it is typed by hand elsewhere. */
function isOwnerLabel(customRole: string | null | undefined): boolean {
  return (customRole ?? '').trim().toLowerCase() === 'owner';
}

/**
 * Confirms `ctx` may act for `orgPartyId` — staff unconditionally, a
 * member of the public only if they are one of its officers or its
 * owner. Shared by every business-handle action below so "who may act
 * for this business" stays defined in exactly one place. Requires
 * `membership.write` first (unqualified for staff, `:own` for a
 * subject — the qualifier only confirms they're a legitimate signed-in
 * party, not that they're this org's officer; that's the Membership
 * lookup that follows).
 */
export async function assertBusinessOfficer(ctx: Ctx, orgPartyId: string): Promise<void> {
  requireCapability(ctx, 'membership.write', { partyId: ctx.partyId });
  if (ctx.actorType === 'STAFF') return;

  if (!ctx.partyId) throw new AuthorisationError('membership.write', ctx);
  const officer = await prisma.membership.findFirst({
    where: {
      orgId: orgPartyId,
      personId: ctx.partyId,
      exitedAt: null,
      status: 'ACTIVE',
      OR: [{ role: { in: BUSINESS_OFFICER_ROLES } }, { customRole: { not: null } }],
    },
    select: { id: true, role: true, customRole: true },
  });
  const isOfficer = officer && (BUSINESS_OFFICER_ROLES.includes(officer.role) || isOwnerLabel(officer.customRole));
  if (!isOfficer) throw new AuthorisationError('membership.write', ctx);
}

/**
 * Issues a business's Esoqo Payment ID. Idempotent — returns the code
 * already on file rather than minting a second one.
 *
 * Requires `membership.write` scoped to the caller's own party: staff
 * hold it unqualified and may act on any business, while a member of
 * the public may only act on a business they are an officer or owner of.
 * The business must already exist, and must not be soft-deleted.
 */
export async function issueBusinessEsoqoPaymentId(ctx: Ctx, orgPartyId: string) {
  const org = await prisma.party.findFirst({
    where: { id: orgPartyId, kind: 'ORGANISATION', deletedAt: null, organisation: { isNot: null } },
    select: { id: true },
  });
  if (!org) {
    throw new PaymentIdError("That business wasn't found", 'NOT_VERIFIED');
  }

  await assertBusinessOfficer(ctx, orgPartyId);

  const existing = await prisma.esoqoPaymentId.findUnique({ where: { partyId: orgPartyId } });
  if (existing) return existing;

  const code = await allocateEsoqoCode(orgPartyId);
  await recordAudit(ctx, {
    action: 'paymentid.issued', targetType: 'esoko_payment_id', targetId: orgPartyId,
    payload: { code, forKind: 'ORGANISATION' },
  });
  return prisma.esoqoPaymentId.findUniqueOrThrow({ where: { partyId: orgPartyId } });
}

/**
 * The org-equivalent of previewMyEsoqoHandleCandidates / confirmMyEsoqoHandle
 * — a mnemonic handle built from the organisation's own name, offered as
 * a few candidates for an officer to choose from, instead of the legacy
 * opaque ESK- code issueBusinessEsoqoPaymentId still mints.
 *
 * Gated on HANDLE_APPLICATION_APPROVED (see dal/handle-application.ts):
 * unlike a person's handle, which only needs a verified phone, a
 * business's *name* is what ends up in the handle, so staff must first
 * confirm the applicant is actually entitled to that name before any
 * candidate is even generated.
 */
export async function previewBusinessHandleCandidates(ctx: Ctx, orgPartyId: string) {
  await assertBusinessOfficer(ctx, orgPartyId);

  const existing = await prisma.esoqoPaymentId.findUnique({ where: { partyId: orgPartyId } });
  if (existing) return { existing, candidates: [] as string[] };

  const approved = await prisma.attestation.findFirst({
    where: { subjectId: orgPartyId, claimType: 'HANDLE_APPLICATION_APPROVED', revokedAt: null },
  });
  if (!approved) {
    throw new PaymentIdError('Apply with your legitimacy documents before claiming a handle', 'NOT_APPROVED');
  }

  const org = await prisma.organisation.findUnique({ where: { partyId: orgPartyId }, select: { officialName: true } });
  const names = (org?.officialName ?? '').split(/\s+/).filter(Boolean);
  return { existing: null, candidates: generateHandleCandidates(names) };
}

/**
 * The single read the officer-facing "claim your handle" panel branches
 * on. previewBusinessHandleCandidates/confirmBusinessEsoqoHandle above
 * are actions — each throws on the wrong state (NOT_APPROVED, already
 * issued) because there's nothing useful to return instead. A panel
 * needs to render *something* for every state, so this reports the
 * state directly rather than making the UI catch and interpret those
 * throws just to decide what to show.
 */
export async function getOrgHandleStatus(ctx: Ctx, orgPartyId: string) {
  await assertBusinessOfficer(ctx, orgPartyId);

  const [existing, approved, anyDocument] = await Promise.all([
    prisma.esoqoPaymentId.findUnique({ where: { partyId: orgPartyId } }),
    prisma.attestation.findFirst({
      where: { subjectId: orgPartyId, claimType: 'HANDLE_APPLICATION_APPROVED', revokedAt: null },
    }),
    prisma.document.findFirst({ where: { partyId: orgPartyId, deletedAt: null } }),
  ]);

  if (existing) {
    return { code: existing.code, applicationStatus: 'ISSUED' as const, candidates: [] as string[] };
  }
  if (approved) {
    const org = await prisma.organisation.findUnique({ where: { partyId: orgPartyId }, select: { officialName: true } });
    const names = (org?.officialName ?? '').split(/\s+/).filter(Boolean);
    return { code: null, applicationStatus: 'APPROVED' as const, candidates: generateHandleCandidates(names) };
  }
  if (anyDocument) {
    return { code: null, applicationStatus: 'PENDING' as const, candidates: [] as string[] };
  }
  return { code: null, applicationStatus: 'NOT_APPLIED' as const, candidates: [] as string[] };
}

/** Reserves whichever candidate previewBusinessHandleCandidates showed —
 *  same re-check-everything shape as confirmMyEsoqoHandle, for the same
 *  reason: nothing stops a client skipping straight to this call. */
export async function confirmBusinessEsoqoHandle(ctx: Ctx, orgPartyId: string, chosenHandle: string) {
  await assertBusinessOfficer(ctx, orgPartyId);

  const existing = await prisma.esoqoPaymentId.findUnique({ where: { partyId: orgPartyId } });
  if (existing) return existing;

  const approved = await prisma.attestation.findFirst({
    where: { subjectId: orgPartyId, claimType: 'HANDLE_APPLICATION_APPROVED', revokedAt: null },
  });
  if (!approved) {
    throw new PaymentIdError('Apply with your legitimacy documents before claiming a handle', 'NOT_APPROVED');
  }

  const code = chosenHandle.trim().toLowerCase();
  if (!isSystemHandleShape(code)) {
    throw new PaymentIdError('That is not a valid esoqo ID', 'HANDLE_TAKEN');
  }

  try {
    await prisma.esoqoPaymentId.create({ data: { partyId: orgPartyId, code, source: 'SYSTEM_GENERATED' } });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    throw new PaymentIdError('Someone just took that esoqo ID — pick another', 'HANDLE_TAKEN');
  }

  await recordAudit(ctx, {
    action: 'paymentid.issued', targetType: 'esoko_payment_id', targetId: orgPartyId,
    payload: { code, forKind: 'ORGANISATION' },
  });
  return prisma.esoqoPaymentId.findUniqueOrThrow({ where: { partyId: orgPartyId } });
}

/**
 * Issues a Payment ID to every existing organisation that lacks one.
 *
 * Business IDs only became possible in the first place once
 * completeRegistration started minting one, which leaves every business
 * registered before that — and every one the demo/reference seeds plant
 * — with a registered business and no way to be paid. They were never
 * refusing to take money; nothing ever gave them a handle.
 *
 * Deliberately ungated on the caller's own membership: this is an
 * operator backfill over the whole table, in the same spirit as
 * backfillRegistrationDocuments, and a per-org membership check would
 * make it impossible to run. Requires registration.write, which is a
 * staff capability — a member of the public cannot reach it.
 *
 * Idempotent, and safe to re-run: organisations that already have an ID
 * are skipped rather than re-minted.
 */
export async function backfillBusinessEsoqoPaymentIds(ctx: Ctx) {
  requireCapability(ctx, 'registration.write');

  const withoutId = await prisma.party.findMany({
    where: {
      kind: 'ORGANISATION',
      deletedAt: null,
      esoqoPaymentId: { is: null },
      organisation: { isNot: null },
    },
    select: { id: true, organisation: { select: { officialName: true } } },
  });

  const issued: { partyId: string; name: string; code: string }[] = [];
  for (const org of withoutId) {
    const code = await allocateEsoqoCode(org.id);
    issued.push({ partyId: org.id, name: org.organisation?.officialName ?? org.id, code });
  }

  if (issued.length > 0) {
    await recordAudit(ctx, {
      action: 'paymentid.backfilled', targetType: 'esoko_payment_id',
      targetId: `${issued.length}-businesses`,
      payload: { count: issued.length, parties: issued },
    });
  }
  return issued;
}

/* ── Group Credit Insight snapshot (v1) ──────────────────────
 *
 * v1 inputs are strictly the events this schema already produces:
 * contribution consistency, attendance reliability, and signature
 * responsiveness/reject-rate. Loan-repayment behaviour is deliberately
 * left out until an internal-lending feature exists to produce that
 * outcome — scoring against an event type that can't yet occur would
 * be inventing data, not deriving it.
 */

const FORMULA_VERSION = 'v1-2026-08';
const LOOKBACK_DAYS = 180;

function scoreFromRatio(numerator: number, denominator: number, floor = 40): number {
  if (denominator === 0) return floor; // no history yet — neutral-low, not zero
  return Math.round(Math.min(100, Math.max(floor, (numerator / denominator) * 100)));
}

/** Computes a fresh snapshot — does not persist unless a caller asks
 *  it to be recorded (see recordInsightSnapshot below). */
export async function computeCreditInsight(ctx: Ctx, partyId: string) {
  requireCapability(ctx, 'portfolio.read', { partyId: ctx.partyId });
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [declared, confirmed, attendance, signatures] = await Promise.all([
    prisma.groupContribution.count({ where: { contributorId: partyId, createdAt: { gte: since } } }),
    prisma.groupContribution.count({
      where: { contributorId: partyId, status: 'CONFIRMED', createdAt: { gte: since } },
    }),
    prisma.attendanceRecord.findMany({ where: { personId: partyId, markedAt: { gte: since } } }),
    prisma.withdrawalSignature.findMany({ where: { signerId: partyId, signedAt: { gte: since } } }),
  ]);

  const attendancePresent = attendance.filter((a) => a.present).length;
  const signatureRejects = signatures.filter((s) => s.decision === 'REJECT').length;

  return {
    formulaVersion: FORMULA_VERSION,
    contributionScore: scoreFromRatio(confirmed, declared),
    attendanceScore: scoreFromRatio(attendancePresent, attendance.length),
    // Responsiveness matters more than reject-rate here — signing at
    // all, promptly, is the trust signal; a REJECT is doing the job
    // correctly, not a strike, so it only shaves a little rather than
    // tanking the score.
    signatureScore: signatures.length === 0 ? 60 : Math.max(40, 100 - signatureRejects * 10),
  };
}

/** Persists a snapshot — the record of "what was computed and shown,"
 *  optionally tied to the ConsentAccess that justified sharing it. */
export async function recordInsightSnapshot(
  ctx: Ctx, partyId: string, disclosedViaConsentAccessId?: string,
) {
  const insight = await computeCreditInsight(ctx, partyId);
  const snapshot = await prisma.groupCreditInsightSnapshot.create({
    data: { partyId, ...insight, disclosedViaConsentAccessId },
  });
  await recordAudit(ctx, {
    action: 'portfolio.snapshot_recorded', targetType: 'group_credit_insight_snapshot', targetId: snapshot.id,
    payload: { partyId, disclosed: Boolean(disclosedViaConsentAccessId) },
  });
  return snapshot;
}

export async function getMyCreditInsight(ctx: Ctx) {
  if (!ctx.partyId) return null;
  return computeCreditInsight(ctx, ctx.partyId);
}
