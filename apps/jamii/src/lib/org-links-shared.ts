import type { Route } from 'next';

/**
 * Pure, DB-free — safe for Client Components (OrgTopNav) to import
 * directly. Kept here rather than in lib/data.ts because that module
 * pulls in @esoko/db, which drags Node-only code (storage.ts's
 * node:fs) into the client bundle the moment anything imports from it
 * client-side.
 */
export function isVerified(org: { party: { attestations: { id: string }[] } }): boolean {
  return org.party.attestations.length > 0;
}

export function orgInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'CB';
}

/**
 * The client-safe half of org-links.ts — no `next/headers` import, so
 * it's the one Client Components (OrgSubnav) may import directly.
 * Server Components should import from '@/lib/org-links' instead,
 * which re-exports everything here plus getOrgLinkMode().
 */
/** Shared by OrgSubnav (primary-domain sub-nav) and OrgTopNav
 *  (whitelabel top nav) — one list, so the two never drift apart. */
export const ORG_NAV_SECTIONS = [
  ['about', 'About'],
  ['programs', 'Programs'],
  ['campaigns', 'Campaigns'],
  ['posts', 'Posts'],
  ['gallery', 'Gallery'],
  ['leadership', 'Leadership'],
  ['faq', 'FAQ'],
  ['contact', 'Contact'],
] as const;

/**
 * OrgTopNav-only — a custom domain's root path is a real, distinct
 * homepage (see o/[slug]/page.tsx), not a redirect to /about the way
 * the primary domain's index is, so it earns its own first nav item.
 * orgHref(mode, '') already resolves to '/' in whitelabel mode.
 */
export const WHITELABEL_NAV_SECTIONS = [['', 'Home'], ...ORG_NAV_SECTIONS] as const;

export interface OrgLinkMode {
  /** '' when serving a custom domain (links are root-relative),
   *  '/o/{slug}' otherwise (today's behaviour, unchanged). */
  base: string;
}

/**
 * `path` with no leading slash, e.g. orgHref(mode, 'c/harvest-drive').
 * Cast to Route the same way every other dynamically-built href in
 * this codebase is (see apps/app's group/treasury links) — typedRoutes
 * can only check statically-known literals, not a runtime-composed
 * path built from a page slug.
 */
export function orgHref(mode: OrgLinkMode, path = ''): Route {
  const clean = path.replace(/^\/+/, '');
  const href = clean ? `${mode.base}/${clean}` : mode.base || '/';
  return href as Route;
}

/**
 * middleware.ts only ever rewrites a custom-domain request into
 * /o/{slug}/... — routes outside that tree (/dashboard, /signin, /start,
 * ...) simply 404 there on purpose, so a visitor on a group's own
 * domain can never wander onto Esoko's own sign-in or another org's
 * dashboard by guessing a path. Anything that must cross back to those
 * routes (e.g. "Manage this page") needs a real absolute link to the
 * primary domain instead of a root-relative one.
 */
export function primaryOrigin(): string {
  return process.env.NEXT_PUBLIC_JAMII_PRIMARY_ORIGIN ?? 'https://ourjamii.co.ke';
}

export function crossToPrimaryHref(mode: OrgLinkMode, path: string): string {
  const clean = path.replace(/^\/+/, '');
  return mode.base === '' ? `${primaryOrigin()}/${clean}` : `/${clean}`;
}

/**
 * The shape listJamiiNavItemsPublic (@esoko/db) resolves — just enough
 * to render a link, no Prisma types crossing into these Client
 * Components. "Home" is never one of these; see JamiiNavItem's own
 * doc comment and resolveNavLinks below.
 */
export interface PublicNavItem {
  id: string;
  label: string;
  targetKind: 'SITE_PAGE' | 'EXTERNAL_URL';
  targetSitePage: { slug: string } | null;
  externalUrl: string | null;
  openInNewTab: boolean;
}

export interface ResolvedNavLink {
  key: string;
  label: string;
  href: string;
  external: boolean;
  newTab: boolean;
}

/**
 * OrgTopNav/OrgSubnav's DB-backed nav — resolved server-side (in
 * OrgSectionShell) from an org's JamiiNavItem rows, replacing the
 * ORG_NAV_SECTIONS/WHITELABEL_NAV_SECTIONS consts above wherever an
 * org actually has nav rows (every org does, post-backfill; the consts
 * remain only as the pre-generic-CMS fallback for the unlikely case of
 * a page with zero rows).
 */
export function resolveNavLinks(items: PublicNavItem[], mode: OrgLinkMode): ResolvedNavLink[] {
  return items.map((item) => {
    if (item.targetKind === 'EXTERNAL_URL' && item.externalUrl) {
      return { key: item.id, label: item.label, href: item.externalUrl, external: true, newTab: item.openInNewTab };
    }
    return {
      key: item.id,
      label: item.label,
      href: orgHref(mode, item.targetSitePage?.slug ?? ''),
      external: false,
      newTab: item.openInNewTab,
    };
  });
}
