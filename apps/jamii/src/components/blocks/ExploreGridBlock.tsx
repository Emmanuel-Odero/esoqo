import Link from 'next/link';
import { orgHref } from '@/lib/org-links-shared';
import type { BlockProps } from './types';

/** Extracted verbatim from the pre-Phase-2 OrgHomeSections — the 4
 *  fixed teaser links are hardcoded copy, not data-driven config. */
export function ExploreGridBlock({ page, mode }: BlockProps) {
  return (
    <section className="wl-section">
      <div className="wl-section-inner">
        <div className="wl-sec-head">
          <span className="wl-eyebrow">Explore</span>
          <h2>Find out more about our work</h2>
        </div>
        <div className="wl-teaser-grid">
          <Link className="wl-teaser-card" href={orgHref(mode, 'about')}>
            <h3>Who we are</h3>
            <p>Our mission, vision and the difference we&apos;re working to make.</p>
            <span className="go">Read more →</span>
          </Link>
          <Link className="wl-teaser-card" href={orgHref(mode, 'programs')}>
            <h3>Programmes</h3>
            <p>{page.programs.length > 0 ? `${page.programs.length} programme areas we run.` : 'What we do, in practice.'}</p>
            <span className="go">Read more →</span>
          </Link>
          <Link className="wl-teaser-card" href={orgHref(mode, 'leadership')}>
            <h3>Team</h3>
            <p>Leadership, governance and how we stay accountable.</p>
            <span className="go">Read more →</span>
          </Link>
          <Link className="wl-teaser-card" href={orgHref(mode, 'contact')}>
            <h3>Contact us</h3>
            <p>Phone, email, address and how to give.</p>
            <span className="go">Read more →</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
