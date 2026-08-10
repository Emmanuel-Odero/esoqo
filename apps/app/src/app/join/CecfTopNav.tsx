import { Icon } from '@esoko/ui';

/**
 * Cross-promotion nav for /join only — not the app's global header
 * (RootLayout has none). The join page is CECF-led: people are joining
 * the Child Elder Care Foundation, and Esoko is the same team's digital
 * toolbox behind that membership (markets, payments, receipts). So the
 * brand centre is CECF, with CECF and "what Esoko does" flanking it —
 * both plain external links, since neither side is this app.
 */
export function CecfTopNav() {
  const esokoUrl = process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3000';
  const cecfUrl = process.env.NEXT_PUBLIC_CECF_URL || 'http://childeldercare.test';

  return (
    <nav className="cecf-topnav" aria-label="Cross-site">
      <span className="cecf-topnav-center">
        <a className="cecf-nav-btn esoko" href={esokoUrl}>
          What Esoko does
        </a>
        <span className="cecf-topnav-brand">
          <span className="cecf-lock" aria-hidden="true"><Icon name="leaf" size={15} /></span>
          <span>Child Elder Care Foundation</span>
          <span className="cecf-brand-sub">+ Esoko</span>
        </span>
        <a className="cecf-nav-btn cecf" href={cecfUrl} target="_blank" rel="noopener noreferrer">
          Visit CECF
        </a>
      </span>
    </nav>
  );
}