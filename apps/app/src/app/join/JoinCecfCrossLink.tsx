import { Icon } from '@esoko/ui';

/**
 * Closing band — one honest pointer for the minority of visitors who
 * meant to register a community group or MSME with CECF, not open an
 * Esoko account directly. Replaces the old CecfPartnershipBand, which
 * fetched CECF's live logo and framed this page as CECF's own front
 * door — no longer true now that CECF runs its own registration at
 * childeldercare.test and this page is esoko's.
 */
export function JoinCecfCrossLink() {
  const cecfUrl = process.env.NEXT_PUBLIC_CECF_URL || 'http://childeldercare.test';

  return (
    <div className="join-band">
      <div className="join-band-inner">
        <span className="join-band-icon" aria-hidden="true"><Icon name="handshake" size={20} /></span>
        <div className="join-band-copy">
          <h3>Registering a community group with CECF?</h3>
          <p>
            The Child &amp; Elder Care Foundation runs its own registration for chamas,
            self-help groups, CBOs and MSMEs, on their own site — free, and separate
            from an Esoko account.
          </p>
          <a className="join-nav-btn cecf" href={cecfUrl} target="_blank" rel="noopener noreferrer">
            Visit CECF <Icon name="chevron-right" size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}
