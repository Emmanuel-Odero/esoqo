import { OrgSectionShell, loadOrgOr404 } from '@/components/OrgSectionShell';
import { getOrgLinkMode } from '@/lib/org-links';
import { RichText } from '@/components/RichText';

export const dynamic = 'force-dynamic';

export default async function AboutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadOrgOr404(slug);
  const mode = await getOrgLinkMode(slug);
  const onCustomDomain = mode.base === '';
  const org = page.organisation;

  return (
    <OrgSectionShell
      slug={slug} title="Who we are" eyebrow="Who we are" noSidebar={onCustomDomain}
      lede={onCustomDomain ? (page.missionShort || undefined) : undefined}
    >
      {onCustomDomain ? (
        <div className="wl-about-grid">
          <div>
            <RichText html={page.aboutUs} fallback={<p>This organisation hasn&rsquo;t written its story yet.</p>} />
          </div>
          <div className="wl-mv-pair">
            {page.missionShort && (
              <div className="wl-mv-card"><h3>Our mission</h3><p>{page.missionShort}</p></div>
            )}
            {page.visionShort && (
              <div className="wl-mv-card"><h3>Our vision</h3><p>{page.visionShort}</p></div>
            )}
            <div className="wl-mv-card">
              <h3>At a glance</h3>
              <p style={{ fontSize: '.92rem' }}>
                Type: {org.kind.replaceAll('_', ' ').toLowerCase()}<br />
                Base: {org.party.county}{org.party.ward ? `, ${org.party.ward}` : ''}<br />
                {org.registrationNo && <>Registration: {org.registrationNo}</>}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <section className="osec">
          <h2>About {org.officialName}</h2>
          <RichText html={page.aboutUs} fallback={<p>This organisation hasn&rsquo;t written its story yet.</p>} />
        </section>
      )}
    </OrgSectionShell>
  );
}
