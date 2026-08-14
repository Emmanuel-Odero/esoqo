import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ctxFromToken, createSession, SESSION_COOKIE, capabilitiesForRole } from '@esoko/auth';
import { anonCtx, type Ctx, listMyJamiiPages } from '@esoko/db';

/** Same session mechanism as the rest of Esoko — see apps/store/src/lib/session.ts. */
export async function getCtx(): Promise<Ctx> {
  const jar = await cookies();
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  return (await ctxFromToken(jar.get(SESSION_COOKIE)?.value, ip)) ?? anonCtx(ip);
}

/** Page guard for /dashboard. The DAL still refuses independently — this is UX. */
export async function requireSubject(): Promise<Ctx> {
  const ctx = await getCtx();
  if (ctx.actorType !== 'SUBJECT' || !ctx.partyId) redirect('/signin');
  return ctx;
}

/** The page(s) the signed-in person can manage, for the dashboard's shell. */
export async function requireMyPage() {
  const ctx = await requireSubject();
  const pages = await listMyJamiiPages(ctx);
  if (pages.length === 0) redirect('/start');
  return { ctx, page: pages[0]!, pages };
}

export async function startSession(partyId: string) {
  const token = await createSession({
    actorType: 'SUBJECT',
    actorId: partyId,
    partyId,
    capabilities: capabilitiesForRole('SUBJECT'),
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 14,
  });
}
