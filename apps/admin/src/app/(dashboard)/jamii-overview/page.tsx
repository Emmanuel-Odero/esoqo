import Link from 'next/link';
import { Icon } from '@esoko/ui';
import {
  getJamiiPageCounts, getCampaignCountsForStaff, getDonationTotalsForStaff,
  getSupportTicketCountsForStaff, listJamiiInterests, getSiteVisitLeaderboard,
  getSiteVisitDomainSplit, getDonorRepeatRate, can,
} from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { DonutChart, RankedBarChart } from '@/components/charts';

export const dynamic = 'force-dynamic';

/**
 * Our Jamii — overview. The umbrella "how is the whole Our Jamii
 * product doing" screen that previously didn't exist — pages,
 * campaigns, donations, applications and site traffic each had their
 * own tab, but nothing summed them up in one place, exactly like the
 * platform Overview did before the cross-domain rebuild. Reuses the
 * same stats functions those tabs already call, plus the site-visit
 * and feature-adoption work built for the platform Overview.
 */
export default async function JamiiOverviewPage() {
  const ctx = await requireStaff();

  const [pages, campaigns, donations, siteLeaderboard, domainSplit, donorRepeat] = await Promise.all([
    getJamiiPageCounts(ctx),
    getCampaignCountsForStaff(ctx),
    getDonationTotalsForStaff(ctx),
    getSiteVisitLeaderboard(ctx, 30),
    getSiteVisitDomainSplit(ctx, 30),
    getDonorRepeatRate(ctx),
  ]);

  const [tickets, interests] = await Promise.all([
    can(ctx, 'support-ticket.read') ? getSupportTicketCountsForStaff(ctx) : null,
    can(ctx, 'jamii-interest.read') ? listJamiiInterests(ctx, {}) : [],
  ]);
  const newApplications = interests.filter((r) => r.status === 'NEW').length;

  return (
    <>
      <div className="head">
        <div>
          <h1>Our Jamii — overview</h1>
          <p>
            Every community mini-site, campaign and gift, together — the same cross-domain view
            the platform Overview gives staff, scoped to Our Jamii alone.
          </p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi g">
          <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}><Icon name="handshake" size={16} /></span>
          <span className="n">{pages.published}</span><span className="l">Published pages</span>
          <span className="sub">{pages.total} total</span>
        </div>
        <div className="kpi b">
          <span className="ico" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}><Icon name="trend-up" size={16} /></span>
          <span className="n">{campaigns.active}</span><span className="l">Active campaigns</span>
        </div>
        <div className="kpi a">
          <span className="ico" style={{ background: 'var(--amber-t)', color: 'var(--amber)' }}><Icon name="coins" size={16} /></span>
          <span className="n">KES {donations.raisedKes.toLocaleString('en-KE')}</span><span className="l">Confirmed, all time</span>
        </div>
        <div className={`kpi ${newApplications > 0 ? 'r' : ''}`}>
          <span className="ico" style={{ background: 'var(--red-t)', color: 'var(--red)' }}><Icon name="users" size={16} /></span>
          <span className="n">{newApplications}</span><span className="l">New applications</span>
          <Link href="/jamii-interest" className="sub" style={{ color: 'var(--blue-2)' }}>Review →</Link>
        </div>
      </div>

      <div className="grid2" style={{ marginBottom: 22 }}>
        <div className="card">
          <h2><Icon name="handshake" size={18} />Pages, by status</h2>
          {pages.total === 0 ? <p className="empty">No pages yet.</p> : (
            <DonutChart size={150} centerLabel={{ value: String(pages.total), sub: 'pages' }} segments={[
              { label: 'Draft', value: pages.draft, color: 'var(--amber)' },
              { label: 'Published', value: pages.published, color: 'var(--green-2)' },
              { label: 'Suspended', value: pages.suspended, color: 'var(--red)' },
            ].filter((s) => s.value > 0)} />
          )}
        </div>

        <div className="card">
          <h2><Icon name="coins" size={18} />Donations, by status</h2>
          {donations.confirmed + donations.pending + donations.failed === 0 ? <p className="empty">No donations yet.</p> : (
            <DonutChart size={150} centerLabel={{ value: String(donations.confirmed + donations.pending + donations.failed), sub: 'donations' }} segments={[
              { label: 'Confirmed', value: donations.confirmed, color: 'var(--green-2)' },
              { label: 'Pending', value: donations.pending, color: 'var(--amber)' },
              { label: 'Failed', value: donations.failed, color: 'var(--red)' },
            ].filter((s) => s.value > 0)} />
          )}
          {donorRepeat.totalGivers > 0 && (
            <p className="sub" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <strong style={{ color: 'var(--tx)' }}>{donorRepeat.repeatRatePct}%</strong> of donors have given more than once.
            </p>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <h2><Icon name="map" size={18} />Site traffic, last 30 days</h2>
        <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
          Cookieless, day-bucketed. New instrumentation — expect this to fill in over the coming
          days, not retroactively.
        </p>
        {siteLeaderboard.length === 0 ? <p className="empty">No visits logged yet.</p> : (
          <>
            <RankedBarChart color="var(--green-2)" rows={siteLeaderboard.map((s) => ({ label: s.slug, value: s.visits }))} />
            <p className="sub" style={{ marginTop: 14 }}>
              {domainSplit.custom.toLocaleString('en-KE')} visits via a custom domain ·{' '}
              {domainSplit.primary.toLocaleString('en-KE')} via esoko.app/o/…
            </p>
          </>
        )}
      </div>

      {tickets && tickets.open > 0 && (
        <div className="chain" style={{ background: 'var(--amber-t)', border: '1px solid #F3DFB0', color: 'var(--amber)' }}>
          <Icon name="alert-triangle" size={18} />
          <span>
            {tickets.open} support ticket{tickets.open === 1 ? '' : 's'} open platform-wide —{' '}
            <Link href="/support-tickets" style={{ color: 'inherit', textDecoration: 'underline' }}>review</Link>.
          </span>
        </div>
      )}
    </>
  );
}
