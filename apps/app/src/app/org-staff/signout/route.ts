import { NextResponse } from 'next/server';
import { destroyTicketStaffSession } from '@/lib/session';

/**
 * Sign out — a plain GET link, same reasoning as the subject /signout
 * route: works as a hard link, and destroys the session server-side
 * even when the handset just walks away from a shared gate device.
 *
 * Lands on apps/web's /tickets, not a path in this app — ticket
 * browsing moved there (apps/web, 3000); apps/app (3001) has no
 * /tickets route of its own anymore. next/navigation's redirect()
 * enforces typedRoutes even for a cast string, and rejects a genuine
 * cross-origin target outright — NextResponse.redirect() is the
 * right tool from a Route Handler, no such constraint.
 */
export async function GET() {
  await destroyTicketStaffSession();
  const webUrl = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';
  return NextResponse.redirect(new URL('/tickets', webUrl));
}
