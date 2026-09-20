import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import {
  ParcelOrgUnauthorised, getParcelOrgMe, parcelOrgFetch,
  type OrgParcelRow,
} from '@/lib/parcel-org-session';
import { OrgParcelsTable } from './OrgParcelsTable';
import { CustomParcelPanel } from './CustomParcelPanel';
import { RiderCashPanel } from './RiderCashPanel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your parcels — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * A courier company's own dashboard — the operator surface two of this
 * product's six personas (a parcel company, and its employees) had no
 * version of at all until now.
 *
 * Everything on this page comes from core-go scoped to the session's
 * own ParcelOrgID. Nothing here takes an org id from the URL, which is
 * why the route has no [orgId] segment: there is exactly one company a
 * given login can be looking at, and making that a path parameter would
 * turn it into something a browser could edit.
 *
 * Reading order is the shift's own order: what needs a person right now
 * (the attention band), then the shape of the day (the KPI board), then
 * the register itself. The KPI tiles are filters, not decoration —
 * every number is a link to exactly the rows behind it.
 */

/**
 * KPI → the register filter that shows exactly those rows.
 *
 * Kept beside the tiles rather than inlined because the mapping has to
 * agree with GetParcelOrgStats's own FILTER clauses in core-go; when
 * one changes the other must, and a reader has to be able to check that
 * in one place. Statuses match dbx.ListOrgParcels, which accepts a
 * comma-separated list for exactly this reason.
 */
interface Kpi {
  key: string;
  label: string;
  sub: string;
  value: number;
  /** Query for the register below; null when no filter can reproduce
   *  the count (delivered TODAY is a date window, not a status). */
  filter: string | null;
  tone: '' | 'a' | 'g' | 'b' | 'r';
  /** Lifts the tile when it is non-zero and somebody has to act. */
  urgentWhenSet?: boolean;
}

export default async function ParcelOrgDashboard(
  { searchParams }: { searchParams: Promise<{ status?: string; q?: string; originMethod?: string }> },
) {
  const { status, q, originMethod } = await searchParams;

  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  let parcels: OrgParcelRow[];
  try {
    const sp = new URLSearchParams();
    if (status) sp.set('status', status);
    if (originMethod) sp.set('originMethod', originMethod);
    if (q) sp.set('q', q);
    const qs = sp.toString();
    const params = qs ? `?${qs}` : '';
    [me, { parcels }] = await Promise.all([
      getParcelOrgMe(),
      parcelOrgFetch<{ parcels: OrgParcelRow[] | null }>(`/v1/parcel-orgs/me/parcels${params}`)
        .then((r) => ({ parcels: r.parcels ?? [] })),
    ]);
  } catch (e) {
    // An expired shift session lands here. Sending them to the
    // company's own door rather than a generic sign-in matters: a rider
    // doesn't know their employer's slug, and /signin is the wrong
    // door — that's the customer's Esoqo account.
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }

  const canSeeEarnings = me.capabilities.includes('parcelorg.earnings');
  const canDispatch = me.capabilities.includes('parcelorg.dispatch');
  const canImport = me.capabilities.includes('parcelorg.write');
  const canCarry = me.capabilities.includes('parcelorg.carry');
  const canDesk = canDispatch || canCarry;
  const { stats } = me;
  const needsAttention = stats.failedDeliveries + stats.atAgent;
  const hasFilter = Boolean(status || q || originMethod);
  // Rebuilt in the same shape the KPI tiles emit, so a tile's filter can
  // be matched back to the tile's own label for the chip below.
  const appliedKpiFilter = status
    ? `status=${status}${originMethod ? `&originMethod=${originMethod}` : ''}`
    : null;
  const isActive = me.org.status === 'ACTIVE';

  const earningsToday = Number(stats.earningsTodayKes);
  const earningsTodayLabel = Number.isFinite(earningsToday)
    ? `KES ${earningsToday.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`
    : '—';

  const kpis: Kpi[] = [
    {
      key: 'dropoff',
      label: 'Awaiting drop-off',
      sub: 'a sender is walking in',
      value: stats.awaitingDropoff,
      filter: 'status=BOOKED&originMethod=SELF_DROPOFF',
      tone: 'a',
      urgentWhenSet: true,
    },
    {
      key: 'pickup',
      label: 'Ready to collect',
      sub: 'waiting for a rider',
      value: stats.awaitingPickup,
      filter: 'status=BOOKED,RECEIVED_AT_COUNTER',
      tone: 'b',
    },
    {
      key: 'transit',
      label: 'On the road',
      sub: 'picked up or in transit',
      value: stats.inTransit,
      filter: 'status=PICKED_UP,IN_TRANSIT',
      tone: 'b',
    },
    {
      key: 'failed',
      label: 'Failed attempts',
      sub: 'somebody has to call the receiver',
      value: stats.failedDeliveries,
      filter: 'status=FAILED_DELIVERY',
      tone: 'r',
      urgentWhenSet: true,
    },
    {
      key: 'agent',
      label: 'At a pickup point',
      sub: 'held for collection',
      value: stats.atAgent,
      filter: 'status=HELD_AT_AGENT',
      tone: 'a',
      urgentWhenSet: true,
    },
    {
      key: 'delivered',
      // No filter: the count is "delivered since midnight" and the
      // register filters by status alone, so a link here would show
      // every parcel ever delivered under a number that says today.
      label: 'Delivered today',
      sub: 'since midnight',
      value: stats.deliveredToday,
      filter: null,
      tone: 'g',
    },
  ];

  return (
    <>
      {/* ── who and what, with the day's headline beside it ── */}
      <section className="porg-hero">
        <div className="porg-hero-copy">
          <p className="kicker">
            {me.org.name}
            {!isActive && <span className="pill p-warn porg-hero-state">Not trading yet</span>}
          </p>
          <h1>Parcel operations</h1>
          <p>
            {canDesk
              ? 'Receiving, booking and labels all live under Counter; runs live under Dispatch.'
              : 'Your role covers this register — Counter and Dispatch appear for colleagues who hold them.'}
            {!isActive && ' This company isn’t active yet — new work won’t be routed to you.'}
          </p>
          <div className="porg-hero-actions">
            {canDesk && (
              <Link href="/parcel-org/counter" className="btn btn-p btn-sm">
                <Icon name="qr" size={15} /> Open counter
              </Link>
            )}
            {canDispatch && (
              <Link href="/parcel-org/dispatch" className="btn btn-o btn-sm">
                <Icon name="send" size={15} /> Dispatch board
              </Link>
            )}
          </div>
        </div>

        {/* Earnings are a manager's business. A rider's session simply
            doesn't carry the capability, and core-go zeroes the figures
            before they ever reach this page — the check here only
            decides whether to draw the panel. */}
        {canSeeEarnings && (
          <div className="porg-today">
            <span className="porg-today-k">Earned today</span>
            <span className="porg-today-v mono">{earningsTodayLabel}</span>
            <span className="porg-today-h">
              {stats.deliveredToday} delivered since midnight
            </span>
          </div>
        )}
      </section>

      {/* Attention before information: a failed delivery is a phone call
          somebody owes a receiver, and it used to sit BELOW the KPI row
          it was summarising. */}
      {needsAttention > 0 && (
        <div className="chain porg-attention" role="status">
          <Icon name="alert-triangle" size={18} />
          <span>
            {stats.failedDeliveries > 0 && (
              <>{stats.failedDeliveries} parcel{stats.failedDeliveries === 1 ? '' : 's'} couldn’t be delivered. </>
            )}
            {stats.atAgent > 0 && <>{stats.atAgent} sitting at a pickup point.</>}
          </span>
          <Link
            className="btn btn-o btn-sm"
            href={
              (stats.failedDeliveries > 0
                ? '/parcel-org?status=FAILED_DELIVERY'
                : '/parcel-org?status=HELD_AT_AGENT') as Route
            }
          >
            Show them <Icon name="arrow-right" size={15} />
          </Link>
        </div>
      )}

      {/* Scanning lives ONLY on Counter (ScanEverythingBar): the
          dashboard used to host its own custody-only scanner plus three
          shortcut cards repeating the header buttons above, so the same
          Counter/Dispatch/Labels entries appeared twice on one screen. */}

      {canImport && <CustomParcelPanel />}

      {/* ── the board. Every tile is the filter for its own number. ── */}
      <nav className="kpis dashboard-kpis" aria-label="Parcels by stage">
        {kpis.map((k) => {
          const cls = `kpi ${k.tone}${k.urgentWhenSet && k.value > 0 ? ' is-urgent' : ''}`;
          const body = (
            <>
              <span className="n">{k.value}</span>
              <span className="l">{k.label}</span>
              <span className="sub">{k.sub}</span>
            </>
          );
          if (!k.filter) return <div className={cls} key={k.key}>{body}</div>;
          const href = `/parcel-org?${k.filter}` as Route;
          const selected = k.filter.split('&').every((pair) => {
            const [name, value] = pair.split('=');
            if (name === 'status') return status === value;
            if (name === 'originMethod') return originMethod === value;
            return false;
          });
          return (
            <Link
              className={`${cls} kpi-link`}
              key={k.key}
              href={href}
              aria-current={selected ? 'true' : undefined}
            >
              {body}
              <Icon name="arrow-right" size={15} className="kpi-go" />
            </Link>
          );
        })}
      </nav>

      {/* Only a manager handles cash — the same capability that gates
          earnings, because counting money in and seeing what it came to
          are the same job. */}
      {canSeeEarnings && <RiderCashPanel />}

      {/* The fleet lives on its own board under the Dispatch tab —
          runs are the unit a dispatcher thinks in, not individual
          parcels, so this dashboard doesn't host a second entry to it. */}

      <div className="porg-register">
        <div className="porg-register-head">
          <h2>The register</h2>
          {/* The status dropdown can only ever name the status half of a
              filter, and two of the board's tiles also pin originMethod
              or span several statuses. This chip names the filter the
              way the tile that set it does, so "why am I seeing these
              rows" never has to be reverse-engineered from a select. */}
          {hasFilter && (
            <span className="porg-applied">
              <Icon name="filter" size={13} />
              {kpis.find((k) => k.filter === appliedKpiFilter)?.label
                ?? (q ? `Matching “${q}”` : 'Filtered')}
              <span className="porg-applied-n">{parcels.length}</span>
            </span>
          )}
          {hasFilter && (
            <Link className="porg-clear" href={'/parcel-org' as Route}>
              <Icon name="close" size={14} />Clear filter
            </Link>
          )}
        </div>

        {/* Both fields are uncontrolled, so React reuses the existing DOM
            node across a soft navigation and their defaultValue is
            ignored on every render after the first — clicking a KPI tile
            filtered the register while the dropdown still read "All
            statuses". Keying the form on the applied filter remounts
            both, so the controls always state what is actually applied. */}
        <form className="porg-filters" key={`${status ?? ''}|${originMethod ?? ''}|${q ?? ''}`}>
          <label className="sr-only" htmlFor="porg-q">Search Esoqo code or your own number</label>
          <input
            id="porg-q" name="q" defaultValue={q ?? ''} className="inp mono porg-search"
            placeholder="Search Esoqo code or your own number"
          />
          <label className="sr-only" htmlFor="porg-status">Filter by status</label>
          {/* A multi-status filter arriving from a KPI tile
              ("BOOKED,RECEIVED_AT_COUNTER") matches no single option, so
              the select would silently show "All statuses" over a
              filtered list. The extra option names what is actually
              applied, and Clear filter above is the way out of it. */}
          <select id="porg-status" name="status" defaultValue={status ?? ''} className="inp mono porg-status">
            <option value="">All statuses</option>
            {status?.includes(',') && <option value={status}>From the board above</option>}
            <option value="DRAFT_PENDING_PAYMENT">Awaiting payment</option>
            <option value="BOOKED">Waiting for a rider</option>
            <option value="RECEIVED_AT_COUNTER">At the station</option>
            <option value="PICKED_UP">Picked up</option>
            <option value="IN_TRANSIT">On the way</option>
            <option value="FAILED_DELIVERY">Delivery attempted</option>
            <option value="HELD_AT_AGENT">At a pickup point</option>
            <option value="DELIVERED">Delivered</option>
            <option value="RETURNED_TO_SENDER">Returned to sender</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          {/* Carried so a search inside a KPI filter doesn't silently
              widen it back out to every origin. */}
          {originMethod && <input type="hidden" name="originMethod" value={originMethod} />}
          <button className="btn btn-o btn-sm" type="submit">
            <Icon name="filter" size={15} />Filter
          </button>
        </form>

        <OrgParcelsTable
          parcels={parcels}
          hasFilter={hasFilter}
          canDispatch={canDispatch}
          canSeeEarnings={canSeeEarnings}
        />
      </div>
    </>
  );
}
