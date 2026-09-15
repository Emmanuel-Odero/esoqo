import 'server-only';
import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Proves that THIS browser started a given registration, not merely that
 * it knows the id.
 *
 * The anonymous join-flow ctx grants a bare (unqualified) `registration.
 * write`/`registration.read` — by design, since there is no account to
 * check yet — which means the capability layer alone cannot stop anyone
 * who obtains another visitor's registration id (a shared device, a
 * leaked link, a support screenshot) from mutating or completing that
 * stranger's record. This cookie is the missing ownership check: signed
 * with the same HMAC pattern @esoqo/db's payment-approval chain already
 * uses, so a guessed or copied UUID alone is not enough.
 */

const COOKIE = 'esoko_reg_tok';
const SECRET = process.env.SESSION_SECRET ?? 'dev-signing-secret';

function sign(id: string): string {
  return createHmac('sha256', SECRET).update(id).digest('hex');
}

/** Call once, right after a registration is created. */
export async function grantRegistrationOwnership(id: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24, // a day is plenty for one sitting at the join flow
    path: '/',
  });
}

/** True only if this browser holds the signed cookie for exactly this id. */
export async function ownsRegistration(id: string): Promise<boolean> {
  if (!id) return false;
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return false;
  const dot = raw.indexOf('.');
  if (dot < 0) return false;
  const regId = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (regId !== id || !sig) return false;
  const expected = Buffer.from(sign(id), 'hex');
  const actual = Buffer.from(sig, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
