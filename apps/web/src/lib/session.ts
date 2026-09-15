import 'server-only';
import { clientIpFrom } from '@esoqo/domain';
import { cookies, headers } from 'next/headers';
import { ctxFromToken, SESSION_COOKIE } from '@esoqo/auth';
import { anonCtx, type Ctx } from '@esoqo/db';
import { redirect } from 'next/navigation';

export async function getCtx(): Promise<Ctx> {
  const jar = await cookies();
  const h = await headers();
  const ip = clientIpFrom((n) => h.get(n)) ?? null;
  return (await ctxFromToken(jar.get(SESSION_COOKIE)?.value, ip)) ?? anonCtx(ip);
}

/** Page guard for logged-in users on the public site. */
export async function requireSubject(): Promise<Ctx> {
  const ctx = await getCtx();
  if (ctx.actorType !== 'SUBJECT' || !ctx.partyId) {
    const target = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'}/signin`;
    redirect(target as Parameters<typeof redirect>[0]);
  }
  return ctx;
}
