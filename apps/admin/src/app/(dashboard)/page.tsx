import { Icon } from '@esoko/ui';
import {
  getOverview, getFunnel, getStepFunnel, getByCounty, getBySegment,
  getOptInRates, getUssdChoiceSplit, verifyChain, getDailyCompletions,
  getFeatureAdoption, getPlatformRevenueSplit, getDonationTotalsForStaff,
  getSupportTicketCountsForStaff, getSiteVisitLeaderboard, getSiteVisitDomainSplit,
  getSmsSpendSummary, getDonorRepeatRate, can,
} from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { AttentionList, SplitPair, type AttentionItem } from '@/components/dash';
import { MiniTrend, RankedBarChart, DonutChart, Gauge } from '@/components/charts';

export const dynamic = 'force-dynamic';

const WINDOWS = [['7', '7 days'], ['30', '30 days'], ['90', '90 days']] as const;

/**
 * Overview.
 *
 * Registration funnel metrics are the original journey-map work —
 * "total registered" is deliberately not the headline, completion rate
 * and the step funnel are what tell you whether onboarding actually
 * works. Everything from "GMV vs Esoko's take" down is the cross-domain
 * layer: the same story for the five other revenue-bearing domains,
 * rendered with real charts (Recharts) instead of the div/canvas
 * approximations this page used before — a gauge for completion rate,
 * a donut for the payment-method split, ranked bar charts for anything
 * that's a leaderboard. Each cross-domain panel is gated by `can()`,
 * not `requireCapability`, so a staff account missing a capability
 * still gets a working page — it just doesn't see sections it
 * couldn't open anyway.
 */
export default async function OverviewPage({
  searchParams,
}: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;

  const [
    o, funnel, stepFunnel, counties, segments, optIn, ussd, chain, daily, features, revenue,
    siteLeaderboard, domainSplit, smsSpend, donorRepeat,
  ] = await Promise.all([
    getOverview(ctx), getFunnel(ctx), getStepFunnel(ctx), getByCounty(ctx), getBySegment(ctx),
    getOptInRates(ctx), getUssdChoiceSplit(ctx), verifyChain(), getDailyCompletions(ctx, days),
    getFeatureAdoption(ctx, days), getPlatformRevenueSplit(ctx, days),
    getSiteVisitLeaderboard(ctx, days), getSiteVisitDomainSplit(ctx, days),
    getSmsSpendSummary(ctx, days), getDonorRepeatRate(ctx),
  ]);

  const [donations, tickets] = await Promise.all([
    can(ctx, 'jamii-donation.read') ? getDonationTotalsForStaff(ctx) : null,
    can(ctx, 'support-ticket.read') ? getSupportTicketCountsForStaff(ctx) : null,
  ]);

  // getDailyCompletions only returns days that had at least one
  // completion — zero-fill so the trend's shape isn't distorted by
  // silently-skipped gap days.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const byDay = new Map(daily.map((d) => [dayKey(new Date(d.day)), d.count]));
  const sparkDays: number[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    sparkDays.push(byDay.get(dayKey(d)) ?? 0);
  }

  const attention: AttentionItem[] = [];
  if (o.awaitingOtp > 0) {
    attention.push({
      severity: 'warn', title: `${o.awaitingOtp} registration${o.awaitingOtp === 1 ? '' : 's'} stuck at OTP`,
      detail: 'Code sent, never confirmed', href: '/registrations',
    });
  }
  if (donations && donations.failed > 0) {
    attention.push({
      severity: 'crit', title: `${donations.failed} donation${donations.failed === 1 ? '' : 's'} failed`,
      detail: 'STK push cancelled, timed out, or declined', href: '/jamii-donations',
    });
  }
  if (tickets && tickets.open > 0) {
    attention.push({
      severity: 'warn', title: `${tickets.open} support ticket${tickets.open === 1 ? '' : 's'} open`,
      detail: `${tickets.inProgress} more in progress`, href: '/support-tickets',
    });
  }

  const revenueBySource = [
    { label: 'Store commerce', value: revenue.bySource.storeCommerce },
    { label: 'Our Jamii giving', value: revenue.bySource.ourJamiiGiving },
    { label: 'Chama treasury', value: revenue.bySource.chamaTreasury },
    { label: 'Registrations', value: revenue.bySource.registrations },
    { label: 'Ticketing', value: revenue.bySource.ticketing },
  ].filter((r) => r.value > 0);

  const paymentSplit = [
    { label: 'M-Pesa', value: revenue.byMethod.MPESA, color: 'var(--green)' },
    { label: 'Cash', value: revenue.byMethod.CASH, color: 'var(--amber)' },
    { label: 'Card / bank', value: revenue.byMethod.CARD, color: 'var(--blue)' },
    { label: 'Other', value: revenue.byMethod.OTHER, color: 'var(--tx-3)' },
  ].filter((s) => s.value > 0);

  return (
    <>
      <div className="head">
        <div>
          <h1>Overview</h1>
          <p>Live pilot data. Nothing here is seeded or simulated.</p>
        </div>
        <div className="actions">
          <form className="ctl" style={{ marginBottom: 0 }}>
            <select className="inp" name="days" defaultValue={String(days)} aria-label="Time window">
              {WINDOWS.map(([v, label]) => <option key={v} value={v}>Last {label}</option>)}
            </select>
            <button className="btn btn-o btn-sm" type="submit"><Icon name="filter" size={14} />Apply</button>
          </form>
        </div>
      </div>

      <div className={`chain ${chain.ok ? 'ok' : 'bad'}`} role="status">
        <Icon name={chain.ok ? 'shield-check' : 'alert-triangle'} size={18} />
        {chain.ok
          ? `Audit chain intact — ${chain.checked.toLocaleString()} events verified`
          : `AUDIT CHAIN BROKEN at event ${chain.brokenAtId}. Investigate before trusting any report.`}
      </div>

      <SplitPair gmvKes={revenue.gmvKes} takeKes={revenue.esokoTakeKes} />

      <div className="kpis">
        <div className="kpi g">
          <span className="l">Joined</span>
          <span className="n">{o.registrationsComplete.toLocaleString()}</span>
          <span className="sub">{o.last24h} in the last 24h</span>
          <MiniTrend data={sparkDays} color="var(--green-2)" />
        </div>
        <div className="kpi">
          <span className="l">Groups &amp; businesses</span>
          <span className="n">{o.organisations.toLocaleString()}</span>
          <span className="sub">of {o.parties.toLocaleString()} people</span>
        </div>
        <div className={`kpi ${o.awaitingOtp > 0 ? 'a' : ''}`}>
          <span className="l">Stuck at OTP</span>
          <span className="n" style={{ color: o.awaitingOtp > 0 ? 'var(--amber)' : undefined }}>{o.awaitingOtp}</span>
          <span className="sub">Sent a code, never confirmed</span>
        </div>
        <div className="kpi" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Gauge pct={o.completionRate} size={72} color="var(--blue)" />
          <div>
            <span className="l" style={{ display: 'block' }}>Completion rate</span>
            <span className="sub" style={{ display: 'block', marginTop: 4 }}>{o.registrationsStarted.toLocaleString()} started</span>
          </div>
        </div>
      </div>

      <div className="grid2" style={{ marginBottom: 22 }}>
        <div className="card">
          <h2><Icon name="coins" size={17} />Revenue, last {days} days</h2>
          <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
            Every revenue-bearing model normalised into one method split — store commerce, Our
            Jamii giving, chama treasury, registration fees and ticketing, together for the first time.
          </p>
          {paymentSplit.length === 0 ? <p className="empty">No confirmed payments in this window.</p> : (
            <DonutChart segments={paymentSplit} currency
              centerLabel={{ value: `KES ${Math.round(revenue.gmvKes / 1000)}K`, sub: 'total GMV' }} />
          )}
          {revenueBySource.length > 0 && (
            <>
              <h2 style={{ marginTop: 22 }}>By source</h2>
              <RankedBarChart rows={revenueBySource} color="var(--blue)" currency />
            </>
          )}
        </div>

        <div className="card">
          <h2><Icon name="chart" size={17} />Feature adoption, last {days} days</h2>
          <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
            Straight from the audit log every meaningful action already writes to — no new
            tracking, just read for the first time as a usage signal.
          </p>
          {features.length === 0 ? <p className="empty">No audit events in this window.</p> : (
            <RankedBarChart rows={features.map((f) => ({ label: f.feature, value: f.count }))} color="var(--navy-2)" />
          )}
        </div>
      </div>

      <div className="grid2" style={{ marginBottom: 22 }}>
        <div className="card">
          <h2><Icon name="map" size={17} />Site traffic, last {days} days</h2>
          <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
            Cookieless, day-bucketed — logged once per page in <code>apps/jamii</code>&rsquo;s own
            middleware. New instrumentation: expect this to fill in over the coming days, not
            retroactively.
          </p>
          {siteLeaderboard.length === 0 ? (
            <p className="empty">No visits logged yet — this just switched on.</p>
          ) : (
            <>
              <RankedBarChart rows={siteLeaderboard.map((s) => ({ label: s.slug, value: s.visits }))} color="var(--green-2)" />
              <p className="sub" style={{ marginTop: 14 }}>
                {domainSplit.custom.toLocaleString('en-KE')} visits via a custom domain ·{' '}
                {domainSplit.primary.toLocaleString('en-KE')} via esoko.app/o/…
              </p>
            </>
          )}
        </div>

        <div className="card">
          <h2><Icon name="phone" size={17} />SMS spend, last {days} days</h2>
          <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
            Estimated at KES {(Number(process.env.SMS_COST_PER_MESSAGE_KES) || 0.8).toFixed(2)} per
            message — a directional cost, not an invoice reconciliation.
          </p>
          {smsSpend.byPurpose.length === 0 ? <p className="empty">No SMS sent in this window.</p> : (
            <>
              <div className="kpis" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 16 }}>
                <div className="kpi">
                  <span className="n">KES {smsSpend.totalKes.toFixed(0)}</span><span className="l">Estimated spend</span>
                </div>
                <div className="kpi">
                  <span className="n">{smsSpend.totalMessages}</span><span className="l">Messages sent</span>
                </div>
              </div>
              <RankedBarChart rows={smsSpend.byPurpose.map((p) => ({ label: p.purpose, value: p.count }))} color="var(--navy-2)" />
            </>
          )}
          {donorRepeat.totalGivers > 0 && (
            <p className="sub" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <strong style={{ color: 'var(--tx)' }}>{donorRepeat.repeatRatePct}%</strong> of donors have
              given more than once ({donorRepeat.repeatGivers} of {donorRepeat.totalGivers}).
            </p>
          )}
        </div>
      </div>

      <div className="grid2" style={{ marginBottom: 22 }}>
        <div className="card">
          <h2><Icon name="alert-triangle" size={17} />Needs attention</h2>
          <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
            Computed from real thresholds across every domain this staff account can see.
          </p>
          <AttentionList items={attention} />
        </div>

        <div className="card">
          <h2>Where people actually drop off</h2>
          <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
            Furthest step reached in the join flow — a shorter bar than the one above it is where
            people are leaving.
          </p>
          <RankedBarChart
            rows={stepFunnel.map((s) => ({ label: `${s.step}. ${s.label}`, value: s.reached }))}
            color="var(--green-2)" />
          {stepFunnel.some((s) => s.stuckHere > 0) && (
            <p className="sub" style={{ marginTop: 12 }}>
              Stuck right now: {stepFunnel.filter((s) => s.stuckHere > 0)
                .map((s) => `${s.stuckHere} at "${s.label}"`).join(' · ')}
            </p>
          )}
        </div>
      </div>

      <div className="grid2" style={{ marginBottom: 22 }}>
        <div className="card">
          <h2>By status</h2>
          <RankedBarChart
            rows={funnel.map((s) => ({ label: s.status.replace(/_/g, ' ').toLowerCase(), value: s.count }))}
            color="var(--green-2)" />
        </div>

        <div className="card">
          <h2>Dialling access taken up</h2>
          {ussd.length === 0 ? (
            <p className="empty">No completed registrations yet.</p>
          ) : (
            <RankedBarChart
              rows={ussd.map((u) => ({
                label: u.choice === 'now' ? 'Set up now' : u.choice === 'later' ? 'Doing it later' : u.choice,
                value: u.count,
              }))}
              color="var(--blue)" height={80} />
          )}
          <h2 style={{ marginTop: 22 }}>What people asked us to send</h2>
          <table className="tbl">
            <tbody>
              <tr><td>Morning prices</td><td className="mono">{optIn.price}%</td></tr>
              <tr><td>Payment receipts</td><td className="mono">{optIn.receipt}%</td></tr>
              <tr><td>Certificate expiry</td><td className="mono">{optIn.expiry}%</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>By county</h2>
          {counties.length === 0 ? <p className="empty">No completed registrations yet.</p> : (
            <RankedBarChart rows={counties.map((c) => ({ label: c.county, value: c.count }))} color="var(--navy-2)" />
          )}
        </div>

        <div className="card">
          <h2>What people do</h2>
          {segments.length === 0 ? <p className="empty">No enterprises recorded yet.</p> : (
            <RankedBarChart
              rows={segments.map((s) => ({ label: s.segment.replace(/-/g, ' '), value: s.count }))}
              color="var(--blue)" />
          )}
        </div>
      </div>
    </>
  );
}
