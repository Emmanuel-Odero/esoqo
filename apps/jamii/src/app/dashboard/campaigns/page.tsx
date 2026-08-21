import Link from 'next/link';
import { listCampaigns, getCampaignStats } from '@esoko/db';
import { requireMyPage } from '@/lib/session';

export default async function CampaignsScreen() {
  const { page } = await requireMyPage();
  const campaigns = await listCampaigns(page.organisationId);
  const withStats = await Promise.all(campaigns.map(async (c) => ({ c, stats: await getCampaignStats(c.id) })));

  return (
    <>
      <div className="titlebar">
        <div><h1 style={{ marginBottom: 4 }}>Campaigns</h1><p className="sub" style={{ marginBottom: 0 }}>Active and past fundraising campaigns.</p></div>
        <Link href="/dashboard/campaigns/new" className="btn btn-ink btn-sm">New campaign</Link>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="dtable">
          <thead><tr><th>Campaign</th><th>Status</th><th>Raised</th><th>Goal</th><th>Supporters</th><th /></tr></thead>
          <tbody>
            {withStats.length === 0 ? (
              <tr><td colSpan={6} style={{ color: '#8a8368' }}>No campaigns yet.</td></tr>
            ) : withStats.map(({ c, stats }) => (
              <tr key={c.id}>
                <td><Link href={`/o/${page.slug}/c/${c.slug}`} style={{ fontWeight: 700 }}>{c.title}</Link></td>
                <td><span className={`status-pill ${c.status === 'ACTIVE' ? 'status-active' : 'status-draft'}`}>{c.status}</span></td>
                <td className="mono">KES {stats.raisedKes.toLocaleString('en-KE')}</td>
                <td className="mono">KES {Number(c.goalKes).toLocaleString('en-KE')}</td>
                <td>{stats.supporters}</td>
                <td><Link href={`/dashboard/campaigns/${c.id}/edit`}>Edit</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
