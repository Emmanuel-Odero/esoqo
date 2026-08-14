'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { destroySession, SESSION_COOKIE } from '@esoko/auth';

/** Ends the owner/subject session — destroys the Redis session and drops
 *  the esoko_session cookie, then lands back on the sign-in page. The
 *  cashier's separate cookie is intentionally left alone: signing the
 *  owner out on a till shouldn't log the cashier out too. */
export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  jar.delete(SESSION_COOKIE);
  redirect('/signin');
}