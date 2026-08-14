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

/** Page guard. The DAL still refuses independently — this is UX. */
export async function requireSubject(): Promise<Ctx> {
  const ctx = await getCtx();
  if (ctx.actorType !== 'SUBJECT' || !ctx.partyId) redirect('/signin');
  return ctx;
}

/**
 * Ticketing org-staff sessions — separate cookie from the owner's, same
 * reasoning as apps/store's cashier session: a gate scanner signs in
 * independently on a device that may never see the owner's own
 * account, so one cookie name would mean either session clobbers the
 * other on sign-in. See dal/ticketing.ts and /org-staff/[slug] for the
 * rest of this flow.
 */
export const TICKET_STAFF_SESSION_COOKIE = 'esoko_ticket_staff_session';
const TICKET_STAFF_SESSION_TTL = 60 * 60 * 16; // a working day, not 14 days on a shared device

export async function getTicketStaffCtx(): Promise<Ctx | null> {
  const jar = await cookies();
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const token = jar.get(TICKET_STAFF_SESSION_COOKIE)?.value;
  if (!token) return null;
  const ctx = await ctxFromToken(token, ip);
  return ctx?.actorType === 'AGENT' && ctx.ticketOrgId ? ctx : null;
}

export async function createTicketStaffSession(input: {
  staffId: string; orgId: string; capabilities: string[];
}): Promise<void> {
  const token = await createSession(
    { actorType: 'AGENT', actorId: input.staffId, ticketOrgId: input.orgId, capabilities: input.capabilities },
    TICKET_STAFF_SESSION_TTL,
  );
  const jar = await cookies();
  jar.set(TICKET_STAFF_SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    maxAge: TICKET_STAFF_SESSION_TTL, path: '/',
  });
}

export async function destroyTicketStaffSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(TICKET_STAFF_SESSION_COOKIE)?.value;
  // A Redis failure must not block the browser from dropping its
  // cookie anyway — same reasoning as the subject /signout route.
  if (token) await destroySession(token).catch(() => {});
  jar.delete(TICKET_STAFF_SESSION_COOKIE);
}

/** Page guard for the /org/[orgId] console — the owning SUBJECT or a
 *  signed-in org-staff AGENT scoped to this exact org may both reach
 *  it; nobody else can. Returns which kind signed in so callers (and
 *  the layout's header) can render the right chrome. The DAL still
 *  refuses independently via assertOwnsOrg on every call — this is UX. */
export async function requireOrgAccess(orgId: string): Promise<
  { kind: 'owner'; ctx: Ctx } | { kind: 'staff'; ctx: Ctx }
> {
  const staffCtx = await getTicketStaffCtx();
  if (staffCtx && staffCtx.ticketOrgId === orgId) return { kind: 'staff', ctx: staffCtx };

  const ctx = await getCtx();
  if (ctx.actorType === 'SUBJECT' && ctx.partyId) return { kind: 'owner', ctx };

  redirect('/signin');
}
