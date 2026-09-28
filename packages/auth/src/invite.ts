import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { redis } from './redis';

/**
 * Group-invite tokens — the thing an SMS link carries when an officer
 * invites someone who is **not on Esoqo yet**.
 *
 * ## Why a token at all
 *
 * inviteMember (packages/db/src/dal/groups.ts) already creates the
 * Person record for a brand-new invitee: their name, their number, and a
 * PENDING membership in the group. But nothing carried that context to
 * the join form, so the link in the invite SMS could only ever be a bare
 * /join — a form asking a stranger to type in details we already held,
 * with no mention of the group they were being asked to join. This is
 * what closes that gap: the link says which invite it is, and /join
 * reads the record back out and prefills from it.
 *
 * ## Why it is not an authorization token
 *
 * The token buys a *prefill* and a *greeting*, nothing more. /join still
 * puts an OTP on the phone number and still refuses to complete without
 * it (see actionVerifyJoinOtp and completeRegistration's
 * msisdnVerifiedAt check), so someone holding a stolen token cannot
 * create an account on a number they don't control, cannot see anything
 * about the group beyond its name, and cannot touch the membership.
 * Treat it accordingly: never put anything in the payload that the
 * recipient of that SMS should not already be allowed to see.
 *
 * ## Shape
 *
 * Deliberately the same design as the session cookie next door in
 * session.ts — an opaque random token, stored under a *hashed* key in
 * Redis with the payload server-side — rather than a signed JWT. Same
 * two reasons: a Redis dump yields no usable tokens, and an invite that
 * is withdrawn or used must stop working immediately, which a
 * self-contained signed token cannot do. It also needs no schema
 * migration and no new secret to be configured.
 *
 * 12 bytes (96 bits) rather than session.ts's 32: this rides inside a
 * 160-character SMS alongside the words that explain it, and 16 base64url
 * characters is the difference between the invite copy fitting one
 * segment and not (see groupInviteNewSms and the budget test in
 * packages/domain/src/sms.test.ts). 96 bits of unguessable, expiring,
 * non-authorizing prefill is not the weak link in this flow.
 */

const TOKEN_BYTES = 12;
/** 30 days. Long enough that an invite still works when someone gets
 *  round to it a fortnight later, short enough that a forwarded link
 *  does not sit live forever. */
const TTL = 60 * 60 * 24 * 30;

export interface InvitePayload {
  /** The group's Party id — the same orgId the membership row carries. */
  orgId: string;
  /** Display name of the group, as the invite SMS named it. */
  orgName: string;
  /** The Person party inviteMember created (or found) for this invitee. */
  personPartyId: string;
  /** Whichever contact the officer invited them on. */
  msisdn?: string;
  email?: string;
  /** The name the officer entered, so /join can prefill it rather than
   *  asking for something we already hold. */
  officialName?: string;
  /** The officer, by name, so the join page can say who invited them. */
  inviterName?: string;
  /** > 0 when the membership is PENDING behind a join fee, so the join
   *  page can be honest about what happens after they finish. */
  joinFeeKes?: number;
}

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const key = (token: string) => `invite:${hashToken(token)}`;

/** Mints a token for an invite and returns it. URL-safe by construction
 *  — it goes straight into a path segment (/i/<token>). */
export async function createInviteToken(payload: InvitePayload, ttlSeconds = TTL): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  await redis.setex(key(token), ttlSeconds, JSON.stringify(payload));
  return token;
}

/** Reads an invite without spending it — /join renders the form from this
 *  and may be reloaded, abandoned and returned to any number of times
 *  before anyone finishes. */
export async function readInviteToken(token: string | undefined | null): Promise<InvitePayload | null> {
  if (!token) return null;
  const raw = await redis.get(key(token));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as InvitePayload;
  } catch {
    // A payload this process can't parse is a payload it can't honour —
    // fall back to the plain, un-prefilled join form rather than erroring
    // someone out of signing up.
    return null;
  }
}

/** Spends the token, once the invitee has actually finished joining.
 *  Failure is swallowed on purpose: the account exists by this point, and
 *  a Redis hiccup must not turn a completed signup into an error screen.
 *  The TTL cleans up whatever this misses. */
export async function consumeInviteToken(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await redis.del(key(token)).catch(() => 0);
}
