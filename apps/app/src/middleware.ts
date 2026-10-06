/**
 * Next.js Middleware — legacy route redirects
 *
 * 1. /org-staff/signout → /orgs/signout (generic signout action)
 *
 * Everything else passes through untouched.
 *
 * This used to also redirect /parcel-org/* to /org/courier/<orgId>/* —
 * a migration toward a generic org-portal scaffold that was never
 * actually built out (see apps/app/src/lib/org-type-config.ts's
 * courier portalRoute comment). /parcel-org is the real, permanent
 * courier portal, not a legacy path to migrate away from, so that
 * redirect is gone along with the scaffold it pointed at.
 */
import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === '/org-staff/signout') {
    return NextResponse.redirect(new URL('/orgs/signout', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/org-staff/signout',
  ],
};
