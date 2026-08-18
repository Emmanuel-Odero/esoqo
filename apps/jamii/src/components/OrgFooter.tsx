import { orgHref, primaryOrigin, orgInitials, WHITELABEL_NAV_SECTIONS, type OrgLinkMode } from '@/lib/org-links-shared';

/**
 * Deliberately narrower than the full org page shape — just the
 * scalar JamiiPage fields this footer actually reads, so both
 * OrgSectionShell's full getJamiiPageBySlug() result and the campaign
 * detail page's lighter getCampaignBySlug().page include satisfy it
 * without a second, near-duplicate query.
 */
interface FooterPage {
  organisation: { officialName: string };
  logoUrl: string | null;
  tagline: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  facebook: string | null;
  instagram: string | null;
  twitter: string | null;
  whatsapp: string | null;
}

const SOCIALS: [keyof Pick<FooterPage, 'facebook' | 'instagram' | 'twitter' | 'whatsapp'>, string][] = [
  ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['twitter', 'X (Twitter)'], ['whatsapp', 'WhatsApp'],
];

/**
 * Ported from the template's own `footer.site` — brand + motto, a
 * link to every section, and a small credit badge — standing in for
 * SiteFooter's CECF blurb entirely. The one thing kept from Our Jamii
 * is that one small credit line at the very bottom: not brand real
 * estate, just where donations on this page actually get processed,
 * the same reasoning a "Payments by Stripe" line earns its keep on
 * any other org's own site.
 */
export function OrgFooter({ page, mode }: { page: FooterPage; mode: OrgLinkMode }) {
  const org = page.organisation;
  const socials = SOCIALS.filter(([key]) => Boolean(page[key]));
  const year = new Date().getFullYear();
  const contact = [page.contactEmail, page.contactPhone, page.website, ...socials.map(([k]) => page[k])].some(Boolean);

  return (
    <footer className="wl-footer">
      <div className="wl-footer-inner">
        <div className="wl-foot-grid">
          <div>
            <div className="wl-foot-brand">
              <span className="wl-brand-mark" aria-hidden={page.logoUrl ? undefined : true}>
                {page.logoUrl ? <img src={page.logoUrl} alt="" /> : orgInitials(org.officialName)}
              </span>
              <span className="wl-brand-word">{org.officialName}</span>
            </div>
            {page.tagline && <div className="wl-foot-motto">{page.tagline}</div>}
          </div>

          <nav className="wl-foot-links" aria-label="Footer">
            {WHITELABEL_NAV_SECTIONS.map(([key, label]) => (
              <a key={key} href={orgHref(mode, key)}>{label}</a>
            ))}
          </nav>

          {contact && (
            <nav className="wl-foot-links" aria-label="Contact">
              {page.contactEmail && <a href={`mailto:${page.contactEmail}`}>{page.contactEmail}</a>}
              {page.contactPhone && <a href={`tel:${page.contactPhone}`}>{page.contactPhone}</a>}
              {page.website && <a href={page.website} target="_blank" rel="noreferrer">{page.website}</a>}
              {socials.map(([key, label]) => (
                <a key={key} href={page[key]!} target="_blank" rel="noreferrer">{label}</a>
              ))}
            </nav>
          )}

          <a href={primaryOrigin()} target="_blank" rel="noreferrer" className="wl-credit">
            ◆ Our Jamii — CECF Community Pages
          </a>
        </div>

        <div className="wl-foot-bottom">
          <span>© {year} {org.officialName}. All rights reserved.</span>
          <span>Payments and page management by Our Jamii</span>
        </div>
      </div>
    </footer>
  );
}
