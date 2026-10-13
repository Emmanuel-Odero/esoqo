import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { listOrgStaff } from '../actions';
import { RiderCashPanel } from '../RiderCashPanel';
import { CounterCashPanel } from '../CounterCashPanel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Overview — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * Overview — the business at a glance, and the one page where money is
 * counted.
 *
 * This replaced the Money tab, which only ever answered "what does the
 * shift owe". A manager opening the portal wants the whole picture
 * first — how much of the day's work is done, what is stuck, what is
 * still to collect — and the reconciliation beneath it answers the
 * second question ("what should be in the box"), so both live on one
 * page instead of forcing a manager to bounce between two.
 *
 * It opens on the figures rather than on the reconciliation form,
 * because the count is checked AGAINST those figures: a manager who
 * lands on an empty input has nothing to compare it to. The KPI board
 * is drawn entirely from getParcelOrgMe().stats — no new endpoint —
 * every tile a real filter the register already supports.
 *
 * Gated on parcelorg.earnings — the same capability that decides
 * whether the register draws today's takings, because reading the
 * business and counting the money in are one job. core-go refuses the
 * underlying calls independently, so a hand-typed URL gets nothing.
 */
export default async function ParcelOrgOverviewPage() {
  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  try {
    me = await getParcelOrgMe();
  } catch (e) {
    // An expired shift session lands at the company's own door, not
    // /signin — that one is the customer's Esoqo account.
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }

  if (!me.capabilities.includes('parcelorg.earnings')) redirect('/parcel-org');

  // Only people with a linked party can be counted in: the remittance
  // is recorded against the person, not against the roster row.
  const staff = await listOrgStaff().catch(() => []);
  const riders = staff.filter((s) => s.active && s.partyId);
  // A company that takes no cash (ParcelOrg.acceptsCash false) has no
  // counter cash to count in, so the whole surface is hidden for it.
  const canCountCounterCash =
    me.capabilities.includes('parcelorg.counter-cash') && me.org.acceptsCash !== false;

  const { stats } = me;
  const money = (raw: string) => {
    const n = Number(raw);
    return Number.isFinite(n)
      ? `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`
      : '—';
  };
  const needsAttention = stats.failedDeliveries + stats.atAgent + stats.overdue;

  return (
    <>
      <div className="head">
        <div>
          <p className="kicker">{me.org.name}</p>
          <h1>Overview</h1>
          <p>
            How the business is doing today, and counting in what your riders
            collected on its behalf.
          </p>
        </div>
      </div>

      {/* The figures first: the count below is checked against these.
          Plain tiles, not links: the register lists only processed,
          paid parcels now (see ListOrgParcelsFilter.CompleteOnly), so a
          tile counting unpaid bookings would open a shorter list than
          the number it sat under. The one exception is earnings, where
          the register IS the breakdown. */}
      <section className="pstats porg-money-stats">
        <Link className="pstat is-lead" href={'/parcel-org?sort=earnings&order=desc' as Route}>
          <span className="pstat-k">Earned today</span>
          <span className="pstat-v mono">{money(stats.earningsTodayKes)}</span>
          <span className="pstat-h">{stats.deliveredToday} delivered since midnight</span>
        </Link>
        <Link className="pstat" href={'/parcel-org?sort=earnings&order=desc' as Route}>
          <span className="pstat-k">Earned all time</span>
          <span className="pstat-v mono">{money(stats.earningsKes)}</span>
          <span className="pstat-h">Your share, after Esoqo&rsquo;s commission</span>
        </Link>
        <div className="pstat">
          <span className="pstat-k">On the road</span>
          <span className="pstat-v mono">{stats.inTransit}</span>
          <span className="pstat-h">
            {stats.inTransit === 1 ? 'parcel' : 'parcels'} out, not yet earned
          </span>
        </div>
        <div className="pstat">
          <span className="pstat-k">Awaiting pickup</span>
          <span className="pstat-v mono">{stats.awaitingPickup}</span>
          <span className="pstat-h">
            {stats.awaitingDropoff > 0
              ? `${stats.awaitingDropoff} sender${stats.awaitingDropoff === 1 ? '' : 's'} dropping off`
              : 'Booked, not yet collected'}
          </span>
        </div>
        <div className="pstat">
          <span className="pstat-k">Needs attention</span>
          <span className="pstat-v mono">{needsAttention}</span>
          <span className="pstat-h">Overdue, failed or waiting at a pickup point</span>
        </div>
        {stats.waitingTickets > 0 && (
          <div className="pstat">
            <span className="pstat-k">Senders waiting</span>
            <span className="pstat-v mono">{stats.waitingTickets}</span>
            <span className="pstat-h">Checked in at the counter, no clerk yet</span>
          </div>
        )}
        {canCountCounterCash && Number(stats.counterCashOutstandingKes) > 0 && (
          <div className="pstat">
            <span className="pstat-k">Counter cash outstanding</span>
            <span className="pstat-v mono">{money(stats.counterCashOutstandingKes)}</span>
            <span className="pstat-h">
              Still with your clerks — {money(stats.counterCashPlatformFeeOwedKes)} of it is Esoqo&rsquo;s share
            </span>
          </div>
        )}
      </section>

      <RiderCashPanel riders={riders} />

      {canCountCounterCash && <CounterCashPanel clerks={riders} />}

      {/* An honest pointer rather than an invented report. There is no
          per-parcel earnings breakdown endpoint yet; the register can
          already sort by what each parcel earned, so send them there
          instead of drawing a chart with no data behind it. */}
      <section className="ppanel">
        <div className="ppanel-head">
          <div>
            <h2>Where the money came from</h2>
            <p>
              The register carries what each parcel earned. Sort by it, filter to a
              date or a status, and export the result.
            </p>
          </div>
          <div className="ppanel-head-actions">
            <Link className="btn btn-o btn-sm" href={'/parcel-org?sort=earnings&order=desc' as Route}>
              <Icon name="chart" size={15} />Highest earning first
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
