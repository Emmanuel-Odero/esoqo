import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { redis } from './redis';
import { ROLE_PRESETS, type Capability, type Ctx, type RoleName } from '@esoko/db';

/**
 * Opaque server-side sessions.
 *
 * Not a JWT: revocation must be instant and total, because "freeze my
 * account" from a stolen handset is a real, urgent flow (SIMAMA). A JWT
 * that stays valid until it expires cannot do that.
 *
 * The cookie holds a random token. Redis holds the session. The token is
 * stored hashed, so a Redis dump does not yield usable session tokens.
 */

const TTL = 60 * 60 * 24 * 14; // 14 days
export const SESSION_COOKIE = 'esoko_session';

export interface SessionData {
  actorType: 'SUBJECT' | 'STAFF' | 'AGENT';
  actorId: string;
  partyId?: string;
  orgId?: string;
  /** Set for an AGENT session scoped to one store — a cashier or
   *  manager signed in at the till. See @esoko/db's Ctx.storeId. */
  storeId?: string;
  /** Set for an AGENT session scoped to one ticketing org — an admin,
   *  manager or gate scanner. See @esoko/db's Ctx.ticketOrgId. */
  ticketOrgId?: string;
  capabilities: Capability[];
  issuedAt: number;
}

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/** ttlSeconds defaults to 14 days — pass a shorter one for anything that
 *  shouldn't linger on a shared device (a till's cashier session, say). */
export async function createSession(data: Omit<SessionData, 'issuedAt'>, ttlSeconds = TTL): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const payload: SessionData = { ...data, issuedAt: Date.now() };
  await redis.setex(`sess:${hashToken(token)}`, ttlSeconds, JSON.stringify(payload));
  if (data.actorId) await redis.sadd(`sess:actor:${data.actorId}`, hashToken(token));
  return token;
}

export async function readSession(token: string | undefined): Promise<SessionData | null> {
  if (!token) return null;
  const raw = await redis.get(`sess:${hashToken(token)}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export async function destroySession(token: string): Promise<void> {
  const h = hashToken(token);
  const raw = await redis.get(`sess:${h}`);
  if (raw) {
    try {
      const s = JSON.parse(raw) as SessionData;
      await redis.srem(`sess:actor:${s.actorId}`, h);
    } catch { /* ignore */ }
  }
  await redis.del(`sess:${h}`);
}

/** Sign out everywhere. Used by account freeze and PIN reset. */
export async function destroyAllSessions(actorId: string): Promise<number> {
  const hashes = await redis.smembers(`sess:actor:${actorId}`);
  if (!hashes.length) return 0;
  await redis.del(...hashes.map((h) => `sess:${h}`), `sess:actor:${actorId}`);
  return hashes.length;
}

/**
 * The ONLY way a Ctx is constructed from a request.
 *
 * Note what is absent: nothing here reads a header. A Ctx cannot be
 * forged by sending `x-middleware-subrequest` or anything like it —
 * which is precisely the CVE-2025-29927 shape.
 */
export async function ctxFromToken(
  token: string | undefined,
  ip?: string | null,
): Promise<Ctx | null> {
  const s = await readSession(token);
  if (!s) return null;
  return {
    actorType: s.actorType,
    actorId: s.actorId,
    capabilities: s.capabilities,
    partyId: s.partyId ?? null,
    orgId: s.orgId ?? null,
    storeId: s.storeId ?? null,
    ticketOrgId: s.ticketOrgId ?? null,
    ip: ip ?? null,
    __verified: true,
  };
}

export function capabilitiesForRole(role: RoleName): Capability[] {
  return [...ROLE_PRESETS[role]];
}
