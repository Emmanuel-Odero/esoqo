import { appEnv } from '@esoqo/domain';

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
 *  `website` (free text a person typed, could be anyone's real site)
 *  always needs this before it's usable as an href. */
function withScheme(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Same idea, but for a JamiiDomain hostname specifically (never
 *  stored with a scheme, see jamiiDomainHostnameSchema) — this one is
 *  environment-aware. In production a custom domain is genuinely
 *  served over TLS (Cloudflare in front of it, see the custom-domains
 *  proposal), so https is correct. Locally there is no TLS terminator
 *  for it at all — middleware.ts resolves the Host header and rewrites
 *  internally, but only this app's own plain-HTTP dev port ever
 *  answers — so forcing https here always dead-ends in a connection
 *  error, same failure regardless of how the domain itself resolves
 *  (`*.localhost` and `*.localtest.me` both already resolve to
 *  loopback on their own; the scheme/port was the actual problem). */
function domainHref(hostname: string): string {
  if (/^https?:\/\//i.test(hostname)) return hostname;
  if (appEnv() === 'production') return `https://${hostname}`;
  return `http://${hostname}:3004`;
}

export function orgExternalUrl(page: PageWithExternalUrl): OrgExternalUrl | null {
  if (page.domain?.hostname) {
    return { href: domainHref(page.domain.hostname), label: page.domain.hostname, kind: 'domain' };
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
