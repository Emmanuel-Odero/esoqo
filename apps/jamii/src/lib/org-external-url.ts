/**
 * "Does this org have their own site, and where does it live?" — one
 * place answering that, used everywhere it's shown (OrgHeader, the
 * whitelabel OrgTopNav, Discover cards) so the precedence rule only
 * exists once: prefer an ACTIVE custom Jamii domain (their own domain
 * pointed at this same page — see packages/db/src/dal/jamii-page.ts's
 * PUBLIC_PAGE_INCLUDE, which already scopes `domain` to ACTIVE-only),
 * fall back to the plain `website` field (any external URL — could be
 * a wholly separate site, e.g. a legacy WordPress/Wix page).
 */

type PageWithExternalUrl = {
  website: string | null;
  domain: { hostname: string } | null;
};

export interface OrgExternalUrl {
  href: string;
  label: string;
  kind: 'domain' | 'website';
}

/** Adds a scheme if the stored value is a bare domain or missing one —
 *  both `website` (free text a person typed) and a JamiiDomain hostname
 *  (never stored with a scheme, see jamiiDomainHostnameSchema) need
 *  this before they're usable as an href. */
function withScheme(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function orgExternalUrl(page: PageWithExternalUrl): OrgExternalUrl | null {
  if (page.domain?.hostname) {
    return { href: withScheme(page.domain.hostname), label: page.domain.hostname, kind: 'domain' };
  }
  if (page.website?.trim()) {
    const href = withScheme(page.website.trim());
    let label = page.website.trim();
    try {
      label = new URL(href).hostname;
    } catch {
      // Malformed website value — fall back to showing it verbatim
      // rather than hiding the link the org explicitly set.
    }
    return { href, label, kind: 'website' };
  }
  return null;
}
