import { Icon } from '@esoko/ui';

/**
 * A light identity strip above the join wizard — not the app's global
 * header (RootLayout has none). This used to be a CECF/Esoko
 * cross-promotion nav; now that this flow is esoko's own registration
 * (CECF runs its own on childeldercare.test), it's just the esoko mark
 * plus one honest way out for someone who arrived here by mistake.
 */
export function JoinTopNav() {
  const cecfUrl = process.env.NEXT_PUBLIC_CECF_URL || 'http://childeldercare.test';

  return (
    <nav className="join-topnav" aria-label="Site">
      <span className="join-topnav-center">
        <span className="join-topnav-brand">
          <span className="join-mark" aria-hidden="true"><Icon name="basket" size={15} /></span>
          <span>Esoko</span>
        </span>
        <a className="join-nav-btn cecf" href={cecfUrl} target="_blank" rel="noopener noreferrer">
          Registering with CECF instead?
        </a>
      </span>
    </nav>
  );
}
