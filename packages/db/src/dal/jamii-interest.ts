import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import type { JamiiInterestStatus, PartyKind } from '@prisma/client';

/**
 * Applications for Our Jamii access (apps/jamii).
 *
 * Our Jamii isn't open sign-up — every first sign-in, whether the
 * applicant already has a CECF/Esoqo Person record or not, has to trace
 * back to one of these being approved (status CONVERTED). See
 * hasJamiiAccess below, which is what apps/jamii's sign-in and set-PIN
 * actions actually check.
 *
 * Two shapes land here, told apart by whether `personId` gets set at
 * submission time:
 *   · already a member — findJamiiApplicant matched their phone/email
 *     to an existing Person. personId is set immediately; approving
 *     just flips status, no new Party.
 *   · brand new — no match. personId stays null until a staff member
 *     approves, at which point approveJamiiInterest creates the Person
 *     the same shape completeRegistration does for an individual join.
 *
 * Deliberately not a Registration — a Registration is CECF membership
 * itself; this is "wants Our Jamii access," reviewed independently, on
 * top of (or, for a new applicant, alongside) that membership.
 */

/** Granted only by apps/jamii's own anonymous request Ctx (mirroring
 *  apps/app/src/app/join/actions.ts's requestCtx) — no staff role should
 *  hold this; it exists so requireCapability still runs on every write,
 *  never "this DAL function trusts its caller unconditionally." */
export const JAMII_INTEREST_CREATE = 'jamii-interest.create';

/**
 * Pre-auth lookup for the "apply to join" form — deliberately does NOT
 * call requireCapability, same reasoning as findSubjectCredential in
 * auth-credential.ts: this runs before the applicant has any session or
 * identity to hold a capability with. Returns only enough to let the UI
 * say "we found you" without leaking anything else about the account —
 * no phone, no email, no county.
 */
export async function findJamiiApplicant(
  identifier: string,
): Promise<{ partyId: string; displayName: string } | null> {
  const trimmed = identifier.trim();
  const isEmail = trimmed.includes('@');
  const person = await prisma.person.findFirst({
    where: isEmail ? { email: trimmed.toLowerCase() } : { msisdn: trimmed },
  });
  if (!person) return null;
  return { partyId: person.partyId, displayName: person.knownAs || person.officialName };
}

/**
 * Does this Person have Our Jamii access? Checked at every sign-in and
 * before an OTP is ever sent for a PIN — not just at first sign-up — so
 * it holds regardless of where the underlying PIN was set (apps/jamii's
 * own set-PIN screen, or CECF's separate join funnel in apps/app; the
 * credential itself is one shared Esoqo identity, see UserCredential).
 *
 * Two ways in: a CONVERTED application (this file), or being on a
 * page's team already — inviting someone (dal/jamii-team.ts) or
 * founding a page (createJamiiPage, which seeds the founder as an ADMIN
 * team member) is itself a vetting act, by an org admin or Esoqo staff,
 * so it isn't made to duplicate through a second application.
 *
 * Same "no requireCapability" reasoning as findJamiiApplicant — this
 * runs as part of deciding whether a Ctx-worthy session gets created at
 * all.
 */
export async function hasJamiiAccess(partyId: string): Promise<boolean> {
  const [approved, teamMember] = await Promise.all([
    prisma.jamiiInterest.findFirst({ where: { personId: partyId, status: 'CONVERTED' }, select: { id: true } }),
    prisma.jamiiTeamMember.findFirst({ where: { personId: partyId, removedAt: null }, select: { id: true } }),
  ]);
  return Boolean(approved || teamMember);
}

/** The applicant's own contact details, for pre-filling the "we already
 *  have your details" application submission server-side — never taken
 *  from client input, so the promise "you don't need to retype this"
 *  is actually enforced, not just a UI courtesy. Same pre-auth, no
 *  requireCapability reasoning as findJamiiApplicant above. */
export async function getApplicantContactDetails(
  partyId: string,
): Promise<{ officialName: string; msisdn: string | null; email: string | null } | null> {
  const person = await prisma.person.findUnique({
    where: { partyId },
    select: { officialName: true, msisdn: true, email: true },
  });
  return person;
}

export interface CreateJamiiInterestInput {
  fullName: string;
  msisdn: string;
  email?: string;
  county?: string;
  organisationName?: string;
  message?: string;
  /** Set by the caller when findJamiiApplicant already matched this
   *  identifier to an existing Person — never accepted from client
   *  input directly (see apps/jamii's actionSubmitApplication, which
   *  re-resolves it server-side rather than trusting the browser). */
  personId?: string;
}

export async function createJamiiInterest(ctx: Ctx, input: CreateJamiiInterestInput) {
  requireCapability(ctx, JAMII_INTEREST_CREATE);

  const fullName = input.fullName.trim();
  if (!fullName) throw new Error('A name is required');
  if (!input.msisdn?.trim()) throw new Error('A phone number is required');

  const row = await prisma.jamiiInterest.create({
    data: {
      fullName,
      msisdn: input.msisdn.trim(),
      email: input.email?.trim().toLowerCase() || undefined,
      county: input.county?.trim() || undefined,
      organisationName: input.organisationName?.trim() || undefined,
      message: input.message?.trim() || undefined,
      personId: input.personId || undefined,
    },
  });

  await recordAudit(ctx, {
    action: 'jamii_interest.created',
    targetType: 'jamii_interest',
    targetId: row.id,
    payload: { msisdn: row.msisdn, county: row.county, matched: Boolean(input.personId) },
  });

  return row;
}

export interface ListJamiiInterestsFilter {
  status?: JamiiInterestStatus;
  search?: string;
}

export async function listJamiiInterests(ctx: Ctx, filter: ListJamiiInterestsFilter = {}) {
  requireCapability(ctx, 'jamii-interest.read');

  return prisma.jamiiInterest.findMany({
    where: {
      status: filter.status,
      ...(filter.search
        ? {
            OR: [
              { fullName: { contains: filter.search, mode: 'insensitive' } },
              { msisdn: { contains: filter.search } },
              { email: { contains: filter.search, mode: 'insensitive' } },
              { organisationName: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function countNewJamiiInterests(ctx: Ctx): Promise<number> {
  requireCapability(ctx, 'jamii-interest.read');
  return prisma.jamiiInterest.count({ where: { status: 'NEW' } });
}

/**
 * Staff triage for CONTACTED/DISMISSED — records who actioned it and
 * why, same "reviewer + note" shape as document review elsewhere in the
 * admin app. Refuses CONVERTED: that transition has to run through
 * approveJamiiInterest below, which is the only path that correctly
 * creates a Person for a brand-new applicant before granting access.
 */
export async function reviewJamiiInterest(
  ctx: Ctx,
  id: string,
  input: { status: Exclude<JamiiInterestStatus, 'CONVERTED'>; reviewNote?: string },
) {
  requireCapability(ctx, 'jamii-interest.write');
  if (!ctx.actorId) throw new Error('Sign in as staff to review an interest submission');
  if ((input.status as JamiiInterestStatus) === 'CONVERTED') {
    throw new Error('Use approveJamiiInterest to grant Our Jamii access');
  }

  const row = await prisma.jamiiInterest.update({
    where: { id },
    data: {
      status: input.status,
      reviewNote: input.reviewNote?.trim() || undefined,
      reviewedByStaffId: ctx.actorId,
      reviewedAt: new Date(),
    },
  });

  await recordAudit(ctx, {
    action: 'jamii_interest.reviewed',
    targetType: 'jamii_interest',
    targetId: row.id,
    payload: { status: row.status },
  });

  return row;
}

/**
 * Approves an application and grants Our Jamii access — the only path
 * that may set status: CONVERTED. For an applicant who already matched
 * an existing Person, that's the whole job. For a brand-new applicant
 * (personId still null), this also creates the Person — the same
 * individual shape dal/registration.ts's completeRegistration builds
 * for a solo CECF join (Party + Person + a WALLET account) — inside the
 * same transaction, so an application is never left CONVERTED without a
 * real account behind it.
 *
 * Re-checks for a Person on this msisdn/email right before creating one,
 * in case the applicant registered through a different path (CECF's own
 * join funnel) in the time between applying and being reviewed — links
 * to that instead of creating a duplicate.
 */
export async function approveJamiiInterest(ctx: Ctx, id: string) {
  requireCapability(ctx, 'jamii-interest.write');
  if (!ctx.actorId) throw new Error('Sign in as staff to review an interest submission');

  return prisma.$transaction(async (tx) => {
    const interest = await tx.jamiiInterest.findUnique({ where: { id } });
    if (!interest) throw new Error('Application not found');
    if (interest.status === 'CONVERTED') return interest; // idempotent

    let personId = interest.personId;

    if (!personId) {
      const existing = await tx.person.findFirst({
        where: { OR: [{ msisdn: interest.msisdn }, ...(interest.email ? [{ email: interest.email }] : [])] },
      });

      if (existing) {
        personId = existing.partyId;
      } else {
        if (!interest.county) {
          throw new Error('This application has no county on file — add one before approving a new account');
        }
        const party = await tx.party.create({
          data: {
            kind: 'PERSON' as PartyKind,
            county: interest.county,
            person: {
              create: {
                officialName: interest.fullName,
                msisdn: interest.msisdn,
                email: interest.email,
              },
            },
            accounts: { create: [{ kind: 'WALLET', currency: 'KES' }] },
          },
        });
        personId = party.id;
      }
    }

    const row = await tx.jamiiInterest.update({
      where: { id },
      data: {
        status: 'CONVERTED',
        personId,
        reviewedByStaffId: ctx.actorId,
        reviewedAt: new Date(),
      },
    });

    await recordAudit(ctx, {
      action: 'jamii_interest.approved',
      targetType: 'jamii_interest',
      targetId: row.id,
      payload: { personCreated: !interest.personId },
    });

    return row;
  });
}
