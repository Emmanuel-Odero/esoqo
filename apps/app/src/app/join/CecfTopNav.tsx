import { Logo } from '@esoko/ui';

/**
 * Cross-promotion nav for /join only — not the app's global header
 * (RootLayout has none). Esoko and CECF share hosting/tooling
 * (see services/cecf-wordpress) without being the same organisation,
 * so "Visit CECF" always leaves the app — a plain external link, not
 * client-side navigation.
 */
export function CecfTopNav() {
  const esokoUrl = process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3000';
  const cecfUrl = process.env.NEXT_PUBLIC_CECF_URL || 'http://childeldercare.test';

  return (
    <nav className="cecf-topnav" aria-label="Cross-site">
      <span className="cecf-topnav-center">
        <a className="cecf-nav-btn esoko" href={esokoUrl}>
          Visit Esoko
        </a>
        <span className="cecf-topnav-brand">
          <Logo />
          <span className="x">&times;</span>
          <span>Child Elder Care Foundation</span>
        </span>
        <a className="cecf-nav-btn cecf" href={cecfUrl} target="_blank" rel="noopener noreferrer">
          Visit CECF
        </a>
      </span>
    </nav>
  );
}
