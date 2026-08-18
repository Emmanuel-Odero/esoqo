import Link from 'next/link';
import { orgHref, type OrgLinkMode } from '@/lib/org-links-shared';

/**
 * The dark "ways to partner / listed on Our Jamii" band — the
 * whitelabel theme's one genuinely distinctive CTA treatment (dark
 * surface, gold eyebrow, a translucent card of its own), used at the
 * close of the homepage and reused here wherever a page needs a real
 * call to action rather than the plain `.wl-jamii-card`-less content
 * cards around it. Pass page-specific copy in; the visual shape stays
 * identical everywhere it appears, which is the whole point of pulling
 * it out of OrgHomeSections instead of leaving a second hand-copy of
 * the same JSX on every page that wants one.
 */
export function OrgDonateBand({
  mode, eyebrow = 'Work with us', heading, body, listItems,
  panelEyebrow = 'Listed on Our Jamii · CECF Community Pages',
  panelBody, ctaLabel = 'Get in touch to give',
}: {
  mode: OrgLinkMode;
  eyebrow?: string;
  heading: string;
  body: string;
  listItems?: string[];
  panelEyebrow?: string;
  panelBody: string;
  ctaLabel?: string;
}) {
  return (
    <div className="wl-partner-band">
      <div>
        <span className="wl-eyebrow" style={{ color: 'var(--wl-gold)' }}>{eyebrow}</span>
        <h2>{heading}</h2>
        <p className="wl-lede">{body}</p>
        {listItems && listItems.length > 0 && (
          <ul className="wl-partner-list">
            {listItems.map((item) => <li key={item}>{item}</li>)}
          </ul>
        )}
      </div>
      <div className="wl-jamii-card">
        <span className="wl-eyebrow">{panelEyebrow}</span>
        <p>{panelBody}</p>
        <Link className="wl-cta" href={orgHref(mode, 'contact')}>{ctaLabel}</Link>
      </div>
    </div>
  );
}
