import { headers } from 'next/headers';
import type { OrgLinkMode } from './org-links-shared';

export * from './org-links-shared';

/**
 * Makes every link on a public org page work identically whether it's
 * reached at ourjamii.co.ke/o/{slug}/... or at the group's own custom
 * domain, where the same page should read as customdomain.org/... with
 * no /o/{slug} segment in the address bar.
 *
 * middleware.ts sets `x-jamii-domain-slug` on every request it resolved
 * from a verified custom domain, rewriting the browser's actual path
 * (e.g. /about) to /o/{slug}/about internally. This is the other half:
 * any link a page builds needs to point back at the *browser's* path
 * shape, not the internally-rewritten one, or navigating would double
 * up the /o/{slug} segment or drop the group's own domain entirely.
 *
 * Server Components only — uses next/headers, which Client Components
 * (OrgSubnav) can't import. Those import orgHref etc. straight from
 * './org-links-shared' instead.
 */
export async function getOrgLinkMode(slug: string): Promise<OrgLinkMode> {
  const h = await headers();
  const customDomainSlug = h.get('x-jamii-domain-slug');
  return { base: customDomainSlug && customDomainSlug === slug ? '' : `/o/${slug}` };
}

/**
 * For the (site) root layout, which wraps every route — not just
 * /o/[slug] — so it has no slug to compare against. Presence alone is
 * enough: middleware.ts only ever sets this header once it has already
 * resolved the Host to a verified, ACTIVE domain, and every such
 * request is guaranteed to land under /o/{slug} (that's all
 * middleware.ts ever rewrites to). Used to suppress SiteHeader/
 * SiteFooter's "Our Jamii"/CECF chrome on a group's own domain.
 */
export async function isCustomDomainRequest(): Promise<boolean> {
  const h = await headers();
  return Boolean(h.get('x-jamii-domain-slug'));
}
