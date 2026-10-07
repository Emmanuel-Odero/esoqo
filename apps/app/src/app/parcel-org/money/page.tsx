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
  title: 'Money — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * Reconciliation — the one page where money is counted.
 *
 * The rider-float panel used to render at the bottom of the parcels
 * register, below the KPI board, which made the register a page about
 * two unrelated jobs. Counting cash in is a manager's end-of-shift
 * task, not something read alongside a parcel list.
 *
 * It opens on the figures rather than on the form, because the first
 * question at the end of a shift is "what should be here", and the
 * count is the answer to it. The form used to be the whole page, which
 * meant a manager arrived at an empty input with nothing to check it
 * against.
 *
 * Gated on parcelorg.earnings — the same capability that decides
 * whether the dashboard draws today's takings, because counting the
 * money in and seeing what it came to are one job. core-go refuses the
 * underlying calls independently, so a hand-typed URL gets nothing.
 */
export default async function ParcelOrgMoneyPage() {
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
  const canCountCounterCash = me.capabilities.includes('parcelorg.counter-cash');

  const { stats } = me;
  const money = (raw: string) => {
    const n = Number(raw);
    return Number.isFinite(n)
      ? `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`
      : '—';
  };

  return (
    <>
      <div className="head">
        <div>
          <p className="kicker">{me.org.name}</p>
          <h1>Money</h1>
          <p>
            What the shift earned, and counting in what your riders collected on
            its behalf.
          </p>
        </div>
      </div>

      {/* The figures first: the count below is checked against these. */}
      <section className="pstats porg-money-stats">
        <div className="pstat is-lead">
          <span className="pstat-k">Earned today</span>
          <span className="pstat-v mono">{money(stats.earningsTodayKes)}</span>
          <span className="pstat-h">{stats.deliveredToday} delivered since midnight</span>
        </div>
        <div className="pstat">
          <span className="pstat-k">Earned all time</span>
          <span className="pstat-v mono">{money(stats.earningsKes)}</span>
          <span className="pstat-h">Your share, after Esoqo&rsquo;s commission</span>
        </div>
        <div className="pstat">
          <span className="pstat-k">Still out</span>
          <span className="pstat-v mono">{stats.inTransit}</span>
          <span className="pstat-h">
            {stats.inTransit === 1 ? 'parcel' : 'parcels'} on the road, not yet earned
          </span>
        </div>
        <div className="pstat">
          <span className="pstat-k">Needs a call</span>
          <span className="pstat-v mono">{stats.failedDeliveries + stats.atAgent}</span>
          <span className="pstat-h">Failed or waiting at a pickup point</span>
        </div>
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
