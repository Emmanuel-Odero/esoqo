import Link from 'next/link';
import { getJamiiPageForManagement, getCampaignStats } from '@esoko/db';
import { requireMyPage } from '@/lib/session';
import { PublishButton } from './PublishButton';

export default async function DashboardOverview() {
  const { ctx, page: myPage } = await requireMyPage();
  const page = await getJamiiPageForManagement(ctx, myPage.organisationId);
  if (!page) return null;

  const statsPerCampaign = await Promise.all(page.campaigns.map((c) => getCampaignStats(c.id)));
  const totalRaised = statsPerCampaign.reduce((sum, s) => sum + s.raisedKes, 0);
  const totalDonors = statsPerCampaign.reduce((sum, s) => sum + s.supporters, 0);
  const activeCampaigns = page.campaigns.filter((c) => c.status === 'ACTIVE').length;

  return (
    <>
      <h1>Dashboard</h1>
      <p className="sub">A quick look at how your page is doing.</p>

      {page.status !== 'PUBLISHED' && (
        <div className="card" style={{ padding: 18, marginBottom: 22, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: '.9rem' }}>
            Your page is still a draft — visitors can&rsquo;t find it on Discover until you publish it.
          </span>
          <PublishButton pageId={page.organisationId} />
        </div>
      )}

      <div className="statcards">
        <div className="card statcard"><div className="sc-label">Total raised</div><div className="sc-val">KES {totalRaised.toLocaleString('en-KE')}</div></div>
        <div className="card statcard"><div className="sc-label">Active campaigns</div><div className="sc-val">{activeCampaigns}</div></div>
        <div className="card statcard"><div className="sc-label">Total donors</div><div className="sc-val">{totalDonors}</div></div>
        <div className="card statcard"><div className="sc-label">Updates posted</div><div className="sc-val">{page.posts.length}</div></div>
      </div>

      <div className="card" style={{ padding: 22 }}>
        <h3 style={{ fontSize: '1rem', color: 'var(--ink)', marginBottom: 14 }}>Quick links</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/dashboard/campaigns/new" className="btn btn-ink btn-sm">New campaign</Link>
          <Link href="/dashboard/posts/new" className="btn btn-outline btn-sm">Post an update</Link>
          <Link href="/dashboard/team" className="btn btn-outline btn-sm">Invite a team member</Link>
          <Link href="/dashboard/settings" className="btn btn-outline btn-sm">Edit page profile</Link>
        </div>
      </div>
    </>
  );
}
