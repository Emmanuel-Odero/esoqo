import { redirect } from 'next/navigation';
import { destroyTicketStaffSession } from '@/lib/session';

/**
 * Sign out — a plain GET link, same reasoning as the subject /signout
 * route: works as a hard link, and destroys the session server-side
 * even when the handset just walks away from a shared gate device.
 */
export async function GET() {
  await destroyTicketStaffSession();
  redirect('/');
}
