import 'server-only';
import { cookies, headers } from 'next/headers';
import { ctxFromToken, SESSION_COOKIE } from '@esoko/auth';
import { anonCtx, type Ctx } from '@esoko/db';
import { redirect } from 'next/navigation';

/**
 * The ONLY way an admin page obtains a Ctx.
 *
 * Reads the session cookie, resolves it against Redis, and returns a
 * verified Ctx. Nothing here reads a header for identity — a Ctx cannot
 * be forged by a request, which is the whole lesson of CVE-2025-29927.
 */
export async function getCtx(): Promise<Ctx> {
  const jar = await cookies();
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ctx = await ctxFromToken(jar.get(SESSION_COOKIE)?.value, ip);
  return ctx ?? anonCtx(ip);
}

/** Page guard. The real check still happens in the DAL. */
export async function requireStaff(): Promise<Ctx> {
  const ctx = await getCtx();
  if (ctx.actorType !== 'STAFF') redirect('/signin');
  return ctx;
}
