import { getJamiiPageForManagement, getJamiiDomain } from '@esoko/db';
import { requireMyPage } from '@/lib/session';
import { SettingsForm } from './SettingsForm';
import { PageAssets } from './PageAssets';
import { DomainPanel } from './DomainPanel';
import { PublishButton } from '../PublishButton';

export default async function SettingsScreen() {
  const { ctx, page: myPage } = await requireMyPage();
  const page = await getJamiiPageForManagement(ctx, myPage.organisationId);
  if (!page) return null;

  const domain = await getJamiiDomain(ctx, page.organisationId);

  const isVerified = page.organisation.party.attestations.length > 0;

  return (
    <>
      <h1>Settings</h1>
      <p className="sub">Appearance, SEO defaults, your domain, and verification status.</p>

      <div className="card" style={{ display: 'flex', gap: 16, alignItems: 'center', padding: 20, marginBottom: 20, maxWidth: 640 }}>
        <span className="stampmark">{isVerified ? 'Verified' : 'Unverified'}</span>
        <div>
          <h4 style={{ fontSize: '.98rem', color: 'var(--ink)', marginBottom: 4 }}>
            Verification status: {isVerified ? 'Verified' : 'Not yet verified'}
          </h4>
          <p style={{ fontSize: '.84rem', color: '#6b6552', margin: 0 }}>
            {isVerified
              ? 'CECF staff reviewed your registration documents and confirmed this page.'
              : 'Upload your registration certificate and a treasurer’s ID via Documents, then ask CECF to review your page.'}
          </p>
        </div>
      </div>

      {page.status !== 'PUBLISHED' && (
        <div className="card" style={{ padding: 18, marginBottom: 20, maxWidth: 640, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '.9rem' }}>Your page is a draft.</span>
          <PublishButton pageId={page.organisationId} />
        </div>
      )}

      <PageAssets pageId={page.organisationId} initialLogoUrl={page.logoUrl} initialCoverUrl={page.coverUrl} />

      <DomainPanel
        pageId={page.organisationId}
        initial={domain && !domain.removedAt ? {
          hostname: domain.hostname,
          status: domain.status,
          verificationToken: domain.verificationToken,
          failureReason: domain.failureReason,
          removedAt: null,
        } : null}
      />

      <SettingsForm
        pageId={page.organisationId}
        initial={{
          brandAccent: page.brandAccent ?? '',
          brandAccentTwo: page.brandAccentTwo ?? '',
          brandAccentThree: page.brandAccentThree ?? '',
          themeDefaultMode: page.themeDefaultMode,
          seoTitle: page.seoTitle ?? '',
          seoDescription: page.seoDescription ?? '',
        }}
      />
    </>
  );
}
