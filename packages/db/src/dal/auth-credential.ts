import { prisma } from '../client';

/**
 * Pre-auth credential lookup and PIN management.
 *
 * These functions deliberately do NOT call requireCapability — they are
 * the mechanism that produces a Ctx in the first place, so gating them
 * on a capability would be circular. Same precedent as the public reads
 * in reference.ts. Nothing here is reachable without already knowing a
 * phone number/email and, for sign-in, a PIN; for setting a PIN, a
 * one-time code sent to that phone.
 */

export interface SubjectCredentialLookup {
  partyId: string;
  pinHash: string | null;
  failedAttempts: number;
  lockedUntil: Date | null;
  frozenAt: Date | null;
  displayName: string;
}

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

/** Looks a subject up by phone (E.164) or email — whichever the identifier looks like. */
export async function findSubjectCredential(identifier: string): Promise<SubjectCredentialLookup | null> {
  const trimmed = identifier.trim();
  const isEmail = trimmed.includes('@');
  const person = await prisma.person.findFirst({
    where: isEmail ? { email: trimmed.toLowerCase() } : { msisdn: trimmed },
    include: { credential: true },
  });
  if (!person) return null;

  return {
    partyId: person.partyId,
    pinHash: person.credential?.pinHash ?? null,
    failedAttempts: person.credential?.failedAttempts ?? 0,
    lockedUntil: person.credential?.lockedUntil ?? null,
    frozenAt: person.credential?.frozenAt ?? null,
    displayName: person.knownAs || person.officialName,
  };
}

export async function recordSignInSuccess(partyId: string): Promise<void> {
  await prisma.userCredential.update({
    where: { personId: partyId },
    data: { failedAttempts: 0, lockedUntil: null },
  });
}

/** Locks the account after LOCKOUT_THRESHOLD wrong PINs — same discipline as OTP's MAX_ATTEMPTS. */
export async function recordSignInFailure(partyId: string): Promise<void> {
  const cred = await prisma.userCredential.update({
    where: { personId: partyId },
    data: { failedAttempts: { increment: 1 } },
  });
  if (cred.failedAttempts >= LOCKOUT_THRESHOLD) {
    await prisma.userCredential.update({
      where: { personId: partyId },
      data: { lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) },
    });
  }
}

export class SetPinError extends Error {
  constructor(msg: string, public readonly code: 'NOT_FOUND') {
    super(msg);
    this.name = 'SetPinError';
  }
}

/**
 * Sets (or resets) a subject's PIN once the caller has verified an OTP
 * for this msisdn — the Server Action calling this must have already
 * called verifyOtp(msisdn, 'PIN_RESET', code) and had it succeed.
 * Upserts UserCredential since a freshly registered Person has none yet.
 */
export async function setSubjectPin(msisdn: string, pinHash: string): Promise<{ partyId: string }> {
  const person = await prisma.person.findUnique({ where: { msisdn } });
  if (!person) throw new SetPinError('No Esoko account found with that number', 'NOT_FOUND');

  await prisma.userCredential.upsert({
    where: { personId: person.partyId },
    create: { personId: person.partyId, pinHash, pinSetAt: new Date() },
    update: { pinHash, pinSetAt: new Date(), failedAttempts: 0, lockedUntil: null },
  });

  return { partyId: person.partyId };
}
