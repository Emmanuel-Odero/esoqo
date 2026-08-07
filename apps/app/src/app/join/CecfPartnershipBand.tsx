/**
 * Real CECF logo, fetched from their own live media library
 * (services/cecf-wordpress) rather than a copy vendored into this repo
 * — one less asset to keep in sync if theirs changes.
 */
export function CecfPartnershipBand() {
  const cecfUrl = process.env.NEXT_PUBLIC_CECF_URL || 'http://childeldercare.test';

  return (
    <div className="cecf-band">
      <div className="cecf-band-inner">
        <div className="cecf-band-logo">
          <img
            src={`${cecfUrl}/app/uploads/2026/08/cecf-logo-transparent.png`}
            alt="Child Elder Care Foundation"
          />
        </div>
        <div className="cecf-band-copy">
          <h3>Built alongside the Child Elder Care Foundation</h3>
          <p>
            CECF supports Kenya&rsquo;s elders and the households who care
            for them. Esoko and CECF are built and run by the same team,
            on shared infrastructure — two different missions, one place
            you can check in on both.
          </p>
          <a className="cecf-nav-btn cecf" href={cecfUrl} target="_blank" rel="noopener noreferrer">
            Visit CECF
          </a>
        </div>
      </div>
    </div>
  );
}
