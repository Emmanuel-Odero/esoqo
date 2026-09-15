import { Icon } from '@esoqo/ui';

/**
 * A light identity strip above the join wizard — not the app's global
 * header (RootLayout has none). This used to be a CECF/Esoqo
 * cross-promotion nav; now that this flow is esoqo's own registration
 * (CECF runs its own on childeldercare.test), it's just the esoqo mark
 * plus one honest way out for someone who arrived here by mistake.
 */
export function JoinTopNav() {
  const cecfUrl = process.env.NEXT_PUBLIC_CECF_URL || 'http://childeldercare.test';

  return (
    <nav className="join-topnav" aria-label="Site">
      <span className="join-topnav-center">
        <span className="join-topnav-brand">
          <span className="join-mark" aria-hidden="true"><Icon name="basket" size={15} /></span>
          <span>Esoqo</span>
        </span>
        <a className="join-nav-btn cecf" href={cecfUrl} target="_blank" rel="noopener noreferrer">
          Registering with CECF instead?
        </a>
      </span>
    </nav>
  );
}
