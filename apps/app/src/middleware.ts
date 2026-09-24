/**
 * Next.js Middleware — org portal URL migration
 *
 * Handles backward-compatible redirects for legacy portal routes:
 *
 * 1. /parcel-org/* → /org/courier/<orgId>/*
 *    Reads the esoqo_parcel_org_session cookie, decodes the org ID from
 *    the JWT payload (no signature verify — this is a redirect hint only;
 *    the destination page will validate the session properly), and
 *    redirects to the typed courier portal URL.
 *
 *    If there's no cookie or we can't decode the org ID, we redirect to
 *    /parcel-org-bridge which prompts the user to sign in again.
 *
 * 2. /org-staff/signout → /orgs/signout (generic signout action)
 *
 * Everything else passes through untouched.
 */
import { NextRequest, NextResponse } from 'next/server';

/** Decode a JWT payload without verifying the signature. */
function jwtOrgId(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf8'),
    );
    // core-go stores the org id as "oid", "orgId", or "parcelOrgId"
    return (
      (payload.oid as string | undefined)
      ?? (payload.orgId as string | undefined)
      ?? (payload.parcelOrgId as string | undefined)
      ?? null
    );
  } catch {
    return null;
  }
}

// Paths that trigger the parcel-org redirect logic
const PARCEL_ORG_SEGMENTS: Record<string, string> = {
  '':         '',           // /parcel-org
  'scan':     'scan',
  'counter':  'counter',
  'dispatch': 'dispatch',
  'money':    'money',
  'settings': 'settings',
  'signed-out': 'signed-out',
};

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── /parcel-org/* redirect ────────────────────────────────────────────
  if (pathname === '/parcel-org' || pathname.startsWith('/parcel-org/')) {
    const token = req.cookies.get('esoqo_parcel_org_session')?.value;

    // No session → send to the "bridge" sign-in page (preserved legacy)
    if (!token) {
      return NextResponse.redirect(new URL('/parcel-org/signed-out', req.url));
    }

    const orgId = jwtOrgId(token);

    // Can't determine org ID → leave the legacy route to handle it
    if (!orgId) {
      return NextResponse.next();
    }

    // Strip /parcel-org prefix and keep the rest of the path
    const rest = pathname.slice('/parcel-org'.length); // '' or '/scan/…'
    const newPath = `/org/courier/${orgId}${rest}`;

    const url = req.nextUrl.clone();
    url.pathname = newPath;
    return NextResponse.redirect(url, { status: 302 });
  }

  // ── /org-staff/signout → generic signout ─────────────────────────────
  if (pathname === '/org-staff/signout') {
    return NextResponse.redirect(new URL('/orgs/signout', req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Run on parcel-org routes and the org-staff signout path only.
  // Excluding static files and Next internals keeps this fast.
  matcher: [
    '/parcel-org',
    '/parcel-org/:path*',
    '/org-staff/signout',
  ],
};
