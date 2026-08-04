import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ctxFromToken, SESSION_COOKIE } from '@esoko/auth';
import { anonCtx, type Ctx } from '@esoko/db';

export async function getCtx(): Promise<Ctx> {
  const jar = await cookies();
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  return (await ctxFromToken(jar.get(SESSION_COOKIE)?.value, ip)) ?? anonCtx(ip);
}

/** Page guard for the merchant dashboard and PoS. The DAL still refuses independently — this is UX. */
export async function requireSubject(): Promise<Ctx> {
  const ctx = await getCtx();
  if (ctx.actorType !== 'SUBJECT' || !ctx.partyId) redirect('/signin');
  return ctx;
}
