import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { Icon, formatKes } from '@esoqo/ui';
import {
  ParcelOrgUnauthorised, getParcelOrgMe, parcelOrgFetch,
  type OrgParcelRow, type ParcelOrgTrendDay,
} from '@/lib/parcel-org-session';
import { listOrgStaff } from './actions';
import { OrgParcelsTable } from './OrgParcelsTable';
import { RegisterFilters } from './RegisterFilters';
import { TrendsStrip } from './TrendsStrip';
import { SavedViews } from './SavedViews';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your parcels — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * A courier company's parcel register — the lookup desk a sender walks
 * up to when they want to know where their parcel is, or to collect it.
 *
 * It lists only parcels that were actually processed and paid (see the
 * complete=1 filter below): a parcel with a label on it and money taken
 * is a parcel somebody will come asking about. Drafts, unpaid
 * pay-at-counter bookings and imports still waiting on a drop-off live
 * on Counter and Scanner instead. The filter box is the search a clerk
 * uses when a parcel or its code is in hand.
 *
 * Everything on this page comes from core-go scoped to the session's
 * own ParcelOrgID. Nothing here takes an org id from the URL, which is
 * why the route has no [orgId] segment: there is exactly one company a
 * given login can be looking at, and making that a path parameter would
 * turn it into something a browser could edit.
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

interface Search {
  status?: string;
  q?: string;
  originMethod?: string;
  parcelType?: string;
  overdue?: string;
  /** The receiver-authentication escalation queue. */
  locked?: string;
  sort?: string;
  order?: string;
  page?: string;
  perPage?: string;
}

const PER_PAGE_OPTIONS = [10, 25, 50];

/**
 * Did somebody arrive here ASKING for specific rows? A bare
 * /parcel-org is a default landing and may be redirected by role; a
 * link carrying a filter is a deliberate destination and never is —
 * the counter's own "view this parcel" link is /parcel-org?q=CODE, and
 * bouncing that to the Scanner would strand the person who followed it.
 */
function hasFilterableSearch(sp: Search): boolean {
  return Boolean(sp.q || sp.status || sp.originMethod || sp.parcelType || sp.overdue || sp.locked);
}

export default async function ParcelOrgDashboard(
  { searchParams }: { searchParams: Promise<Search> },
) {
  const sp = await searchParams;
  const { status, q, originMethod, parcelType, overdue, locked, sort, order } = sp;
  const perPage = PER_PAGE_OPTIONS.includes(Number(sp.perPage)) ? Number(sp.perPage) : 25;
  const page = Math.max(1, Number(sp.page) || 1);
  const sortKey = ['created', 'code', 'status', 'earnings'].includes(sort ?? '') ? sort! : 'created';
  const orderKey = order === 'asc' || order === 'desc' ? order : '';
  const overdueOnly = overdue === '1' || overdue === 'true';
  const lockedOnly = locked === '1' || locked === 'true';

  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  let parcels: OrgParcelRow[];
  let total = 0;
  let trends: ParcelOrgTrendDay[] = [];
  try {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (originMethod) qs.set('originMethod', originMethod);
    if (q) qs.set('q', q);
    if (parcelType) qs.set('parcelType', parcelType);
    if (overdueOnly) qs.set('overdue', '1');
    if (lockedOnly) qs.set('locked', '1');
    // This register only ever lists parcels that were taken in, finished
    // and paid — the ones a sender comes to the desk to look up or
    // collect. Drafts, unpaid pay-at-counter bookings and imports still
    // awaiting drop-off have their own surfaces (Counter, Scanner). See
    // ListOrgParcelsFilter.CompleteOnly.
    qs.set('complete', '1');
    if (sortKey !== 'created' || orderKey) {
      qs.set('sort', sortKey);
      if (orderKey) qs.set('order', orderKey);
    }
    qs.set('page', String(page));
    qs.set('perPage', String(perPage));
    const params = `?${qs.toString()}`;
    const list = parcelOrgFetch<{ parcels: OrgParcelRow[] | null; total?: number }>(
      `/v1/parcel-orgs/me/parcels${params}`,
    ).then((r) => ({ parcels: r.parcels ?? [], total: r.total ?? r.parcels?.length ?? 0 }));
    const trendReq = parcelOrgFetch<{ days: ParcelOrgTrendDay[] | null }>(
      '/v1/parcel-orgs/me/trends',
    ).then((r) => r.days ?? []).catch(() => [] as ParcelOrgTrendDay[]);
    [me, { parcels, total }, trends] = await Promise.all([getParcelOrgMe(), list, trendReq]);
  } catch (e) {
    // An expired shift session lands here. Sending them to the
    // company's own door rather than a generic sign-in matters: a rider
    // doesn't know their employer's slug, and /signin is the wrong
    // door — that's the customer's Esoqo account.
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }

  // Land each session on its own job. A rider opening the portal wants
  // the scan box, not a register they can't act on — this page is a
  // manager's review surface, and it was everyone's front door only
  // because it happens to sit at the root path. The nav still carries
  // "Parcels", so this redirects the default, it doesn't lock anyone
  // out. Anyone with a desk or office role (dispatch, earnings, write)
  // stays here; a pure box-handler goes to the Scanner.
  const isFieldOnly = !me.capabilities.some((c) =>
    ['parcelorg.dispatch', 'parcelorg.earnings', 'parcelorg.write'].includes(c),
  ) && me.capabilities.some((c) =>
    ['parcelorg.carry', 'parcelorg.intake', 'parcelorg.arrival'].includes(c),
  );
  if (isFieldOnly && !hasFilterableSearch(sp)) redirect('/parcel-org/scan');

  const canSeeEarnings = me.capabilities.includes('parcelorg.earnings');
  const canDispatch = me.capabilities.includes('parcelorg.dispatch');
  const canIntake = me.capabilities.includes('parcelorg.intake');
  const canCarry = me.capabilities.includes('parcelorg.carry');

  // The assign picker's options. Only a roster member with a linked
  // party can take custody — a handoff is recorded against the person,
  // never against a login row. Fetched only when the session can
  // actually assign, so a rider's dashboard costs one call fewer.
  const riders = canDispatch
    ? (await listOrgStaff().catch(() => [])).filter((s) => s.active && s.partyId)
    : [];
  const canDesk = canDispatch || canCarry;
  const { stats } = me;
  const overdueCount = (stats as { overdue?: number }).overdue ?? 0;
  const needsAttention = stats.failedDeliveries + stats.atAgent + overdueCount;
  const hasFilter = Boolean(status || q || originMethod || parcelType || overdueOnly || lockedOnly);
  // Rebuilt in the same shape the KPI tiles emit, so a tile's filter can
  // be matched back to the tile's own label for the chip below.
  const appliedKpiFilter = status
    ? `status=${status}${originMethod ? `&originMethod=${originMethod}` : ''}`
    : null;
  const isActive = me.org.status === 'ACTIVE';
  const currentQuery = new URLSearchParams(
    Object.entries({ status, q, originMethod, parcelType, ...(overdueOnly ? { overdue: '1' } : {}), ...(lockedOnly ? { locked: '1' } : {}) })
      .filter(([, v]) => Boolean(v)) as [string, string][],
  ).toString();

  const earningsToday = Number(stats.earningsTodayKes);
  const earningsTodayLabel = Number.isFinite(earningsToday)
    ? formatKes(earningsToday)
    : '—';

  const kpis: Kpi[] = [
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
      key: 'overdue',
      label: 'Past SLA',
      sub: 'still moving, running late',
      value: overdueCount,
      filter: 'overdue=1',
      tone: 'r',
      urgentWhenSet: true,
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
            {overdueCount > 0 && <>{overdueCount} past SLA. </>}
            {stats.failedDeliveries > 0 && (
              <>{stats.failedDeliveries} parcel{stats.failedDeliveries === 1 ? '' : 's'} couldn’t be delivered. </>
            )}
            {stats.atAgent > 0 && <>{stats.atAgent} sitting at a pickup point.</>}
          </span>
          <Link
            className="btn btn-o btn-sm"
            href={
              (overdueCount > 0
                ? '/parcel-org?overdue=1'
                : stats.failedDeliveries > 0
                  ? '/parcel-org?status=FAILED_DELIVERY'
                  : '/parcel-org?status=HELD_AT_AGENT') as Route
            }
          >
            Show them <Icon name="arrow-right" size={15} />
          </Link>
        </div>
      )}

      {/* This page reviews the register and nothing else. Scanning lives
          on /parcel-org/scan, booking (including the bulk import panel
          that used to render here) on /parcel-org/counter, and cash
          reconciliation on /parcel-org/overview — each one job, one page.
          Before that split this single screen booked parcels, counted
          rider float, and listed the register all at once. */}

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
            if (name === 'overdue') return overdueOnly && value === '1';
            if (name === 'locked') return lockedOnly && value === '1';
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

      <TrendsStrip days={trends} />

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
              {(kpis.find((k) => k.filter === appliedKpiFilter)?.label
                ?? (lockedOnly ? 'Receiver locked out' : null)
                ?? (overdueOnly ? 'Past SLA' : null)
                ?? (q ? `Matching “${q}”` : null)
                ?? 'Filtered')}
              <span className="porg-applied-n">{total}</span>
            </span>
          )}
          {hasFilter && (
            <Link className="porg-clear" href={'/parcel-org' as Route}>
              <Icon name="close" size={14} />Clear filter
            </Link>
          )}
        </div>

        <SavedViews currentQuery={currentQuery} />

        {/* Client-side submit → soft navigation, no full reload. Keyed
            on the applied filter so the controls remount (and therefore
            restate) what is actually applied after a KPI-tile click —
            React would otherwise reuse the DOM node and leave the
            dropdown reading "All statuses" over a filtered list. */}
        <RegisterFilters
          key={`${status ?? ''}|${originMethod ?? ''}|${q ?? ''}|${parcelType ?? ''}|${overdueOnly}|${lockedOnly}`}
          status={status}
          q={q}
          parcelType={parcelType}
          overdueOnly={overdueOnly}
          lockedOnly={lockedOnly}
          originMethod={originMethod}
        />

        <OrgParcelsTable
          parcels={parcels}
          total={total}
          page={page}
          perPage={perPage}
          sort={sortKey}
          order={orderKey || (sortKey === 'code' || sortKey === 'status' ? 'asc' : 'desc')}
          hasFilter={hasFilter}
          canDispatch={canDispatch}
          canSeeEarnings={canSeeEarnings}
          canIntake={canIntake}
          riders={riders}
          orgName={me.org.name}
          orgLogoUrl={me.org.logoUrl ?? undefined}
        />
      </div>
    </>
  );
}
