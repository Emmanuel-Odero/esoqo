'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { destroySession, SESSION_COOKIE } from '@esoqo/auth';

/** Ends the subject session — mirrors apps/store's dashboard signout action. */
export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  jar.delete(SESSION_COOKIE);
  redirect('/signin');
}
