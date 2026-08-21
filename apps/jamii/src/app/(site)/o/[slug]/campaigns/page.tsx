import Link from 'next/link';
import { getCampaignStats } from '@esoko/db';
import { OrgSectionShell, loadOrgOr404 } from '@/components/OrgSectionShell';
import { getOrgLinkMode, orgHref } from '@/lib/org-links';
import { buildOrgMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [page, mode] = await Promise.all([loadOrgOr404(slug), getOrgLinkMode(slug)]);
  return buildOrgMetadata(page, mode, { path: 'campaigns', titleSuffix: 'Campaigns' });
}

export default async function CampaignsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadOrgOr404(slug);
  const mode = await getOrgLinkMode(slug);
  const withStats = await Promise.all(
    page.campaigns.map(async (c) => ({ campaign: c, stats: await getCampaignStats(c.id) })),
  );
  const active = withStats.filter((c) => c.campaign.status === 'ACTIVE');
  const past = withStats.filter((c) => c.campaign.status !== 'ACTIVE');

  return (
    <OrgSectionShell slug={slug} title="Campaigns">
      <section className="osec">
        <h2>Campaigns</h2>
        {active.length === 0 && past.length === 0 && <p>No campaigns yet.</p>}
        {active.map(({ campaign, stats }) => {
          const goal = Number(campaign.goalKes);
          const pct = goal > 0 ? Math.min(100, Math.round((stats.raisedKes / goal) * 100)) : 0;
          return (
            <div key={campaign.id} className="accitem open acc-camp">
              <div className="acchead">
                <span className="acctitle">{campaign.title}</span>
              </div>
              <div className="accbody-inner">
                <p style={{ margin: 0 }}>{campaign.summary}</p>
                <div className="ledgerbar"><div className="fill" style={{ width: `${pct}%` }} /></div>
                <div className="pc-row">
                  <span><b style={{ color: 'var(--ledger)' }}>KES {stats.raisedKes.toLocaleString('en-KE')}</b> of KES {goal.toLocaleString('en-KE')}</span>
                  <span>{stats.supporters} supporters</span>
                </div>
                <Link href={orgHref(mode, `c/${campaign.slug}`)} className="btn btn-ink btn-sm" style={{ marginTop: 10, display: 'inline-flex' }}>
                  Open campaign →
                </Link>
              </div>
            </div>
          );
        })}
        {past.length > 0 && (
          <>
            <h3 style={{ marginTop: 24, marginBottom: 10, fontSize: '1rem', color: 'var(--ink)' }}>Past campaigns</h3>
            {past.map(({ campaign, stats }) => (
              <div key={campaign.id} className="accitem acc-camp">
                <div className="acchead">
                  <span className="acctitle">{campaign.title}</span>
                </div>
                <div className="accbody-inner">
                  <p style={{ margin: 0 }}>{campaign.summary}</p>
                  <div className="pc-row">
                    <span><b style={{ color: 'var(--ledger)' }}>KES {stats.raisedKes.toLocaleString('en-KE')}</b> raised</span>
                    <span>{stats.supporters} supporters</span>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </section>
    </OrgSectionShell>
  );
}
