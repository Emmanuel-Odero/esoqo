import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { destroySession, SESSION_COOKIE } from '@esoko/auth';

/**
 * Sign out — a plain GET link (not a Server Action) so a hard link and a
 * shortcut both work, and so the session is destroyed server-side even
 * when the handset is just walking away from the PWA.
 */
export async function GET() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    // destroySession removes the Redis entry; a failure must not block
    // the browser from dropping its cookie anyway.
    await destroySession(token).catch(() => {});
  }
  jar.delete(SESSION_COOKIE);
  redirect('/join');
}