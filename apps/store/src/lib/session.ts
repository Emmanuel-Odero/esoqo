import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ctxFromToken, createSession, destroySession, SESSION_COOKIE } from '@esoko/auth';
import { anonCtx, type Ctx } from '@esoko/db';

export async function getCtx(): Promise<Ctx> {
  const jar = await cookies();
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  return (await ctxFromToken(jar.get(SESSION_COOKIE)?.value, ip)) ?? anonCtx(ip);
}

/** Page guard for the merchant dashboard. The DAL still refuses independently — this is UX. */
export async function requireSubject(): Promise<Ctx> {
  const ctx = await getCtx();
  if (ctx.actorType !== 'SUBJECT' || !ctx.partyId) redirect('/signin');
  return ctx;
}

/**
 * Cashier sessions — separate cookie from the owner's, on purpose. A
 * cashier signs in independently on the till device; the owner may or
 * may not ever be logged in on that same device. Sharing one cookie
 * name would mean one session clobbers the other every time either
 * signs in, which is exactly the shared-terminal scenario this exists
 * for. See dal/cashier.ts and signin/cashier/[slug] for the rest of
 * this flow.
 */
export const CASHIER_SESSION_COOKIE = 'esoko_cashier_session';
const CASHIER_SESSION_TTL = 60 * 60 * 16; // a working day, generously — not 14 days on a shared tablet

export async function getCashierCtx(): Promise<Ctx | null> {
  const jar = await cookies();
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const token = jar.get(CASHIER_SESSION_COOKIE)?.value;
  if (!token) return null;
  const ctx = await ctxFromToken(token, ip);
  return ctx?.actorType === 'AGENT' && ctx.storeId ? ctx : null;
}

export async function createCashierSession(input: {
  cashierId: string; storeId: string; capabilities: string[];
}): Promise<void> {
  const token = await createSession(
    { actorType: 'AGENT', actorId: input.cashierId, storeId: input.storeId, capabilities: input.capabilities },
    CASHIER_SESSION_TTL,
  );
  const jar = await cookies();
  jar.set(CASHIER_SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    maxAge: CASHIER_SESSION_TTL, path: '/',
  });
}

export async function destroyCashierSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(CASHIER_SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  jar.delete(CASHIER_SESSION_COOKIE);
}

/** Page guard for the PoS terminal — an owner (SUBJECT) or a signed-in
 *  cashier/manager (AGENT) may both reach it; nobody else can. Returns
 *  which kind signed in so the caller can render the right chrome. */
export async function requireStoreAccess(): Promise<
  { kind: 'owner'; ctx: Ctx } | { kind: 'cashier'; ctx: Ctx }
> {
  const cashierCtx = await getCashierCtx();
  if (cashierCtx) return { kind: 'cashier', ctx: cashierCtx };

  const ctx = await getCtx();
  if (ctx.actorType === 'SUBJECT' && ctx.partyId) return { kind: 'owner', ctx };

  redirect('/signin');
}
