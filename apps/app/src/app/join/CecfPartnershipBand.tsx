import { Icon } from '@esoko/ui';

/**
 * The page's honest centrepiece: why a CECF membership shares a record
 * with Esoko. Not "two friendly orgs that happen to host here" — CECF
 * is the membership and Esoko is the same team's toolbox, and one
 * registration feeds both. The handshake→tools line says plainly that
 * sharing is the point, and that it is never done by default.
 *
 * Real CECF logo is fetched from their own live media library
 * (services/cecf-wordpress) rather than vendored into this repo.
 */
export function CecfPartnershipBand() {
  const cecfUrl = process.env.NEXT_PUBLIC_CECF_URL || 'http://childeldercare.test';

  return (
    <div className="cecf-band">
      <div className="cecf-band-inner">
        <div className="cecf-band-logo">
          <img
            src={`${cecfUrl}/app/uploads/2026/08/cecf-logo-transparent.png`}
            alt="Child & Elder Care Foundation"
          />
        </div>
        <div className="cecf-band-copy">
          <h3>Your record, shared to work</h3>
          <p>
            CECF is who you join; Esoko is the same team&rsquo;s toolbox for what your group
            or business earns and trades. One registration feeds both — CECF&rsquo;s path to
            formal recognition, and Esoko&rsquo;s prices, payments and receipts — so the
            record that gets you counted then works for you.
          </p>

          <div className="cecf-flow" aria-hidden="true">
            <span className="cecf-flow-node">
              <Icon name="seal" size={15} /> CECF membership
            </span>
            <Icon name="chevron-right" size={16} className="cecf-flow-arrow" />
            <span className="cecf-flow-node ochre">
              <Icon name="handshake" size={15} /> shared on purpose
            </span>
            <Icon name="chevron-right" size={16} className="cecf-flow-arrow" />
            <span className="cecf-flow-node">
              <Icon name="basket" size={15} /> Esoko tools
            </span>
          </div>

          <p className="cecf-band-note">
            Nothing else is shared, and nothing by default. You decide who sees each part of
            your record, every time.
          </p>
          <a className="cecf-nav-btn cecf" href={cecfUrl} target="_blank" rel="noopener noreferrer">
            Visit CECF
          </a>
        </div>
      </div>
    </div>
  );
}