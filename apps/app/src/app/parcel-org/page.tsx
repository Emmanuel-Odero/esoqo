import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import {
  ParcelOrgUnauthorised, getParcelOrgMe, parcelOrgFetch,
  type OrgParcelRow,
} from '@/lib/parcel-org-session';
import { OrgParcelsTable } from './OrgParcelsTable';
import { CustomParcelPanel } from './CustomParcelPanel';
import { RiderCashPanel } from './RiderCashPanel';
import { DropoffPoll } from './DropoffPoll';
import { DashboardScanner } from './DashboardScanner';

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
 */
export default async function ParcelOrgDashboard(
  { searchParams }: { searchParams: Promise<{ status?: string; q?: string }> },
) {
  const { status, q } = await searchParams;

  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  let parcels: OrgParcelRow[];
  try {
    const sp = new URLSearchParams();
    if (status) sp.set('status', status);
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

  return (
    <>
      <div className="head">
        <div>
          <p className="kicker">{me.org.name}</p>
          <h1>Parcel operations</h1>
          <p>
            Start a task or review the parcels that need attention.
            {me.org.status !== 'ACTIVE' && ' This company isn’t active yet — new work won’t be routed to you.'}
          </p>
        </div>
        <div className="actions">
          {canDesk && (
            <Link href="/parcel-org/counter" className="btn btn-p btn-sm">
              <Icon name="qr" size={15} /> Open counter
            </Link>
          )}
          {canDispatch && (
            <Link href="/parcel-org/dispatch" className="btn btn-o btn-sm">
              <Icon name="send" size={15} /> Dispatch
            </Link>
          )}
        </div>
      </div>

      <DropoffPoll />

      {canCarry && <DashboardScanner />}

      <section className="courier-actions" aria-label="Start a task">
        {canDesk && (
          <Link href="/parcel-org/counter" className="courier-action">
            <span className="courier-action-icon green"><Icon name="qr" size={19} /></span>
            <span><strong>Counter</strong><small>Receive or book a parcel</small></span>
            <Icon className="courier-action-arrow" name="arrow-right" size={17} />
          </Link>
        )}
        {canDispatch && (
          <Link href="/parcel-org/dispatch" className="courier-action">
            <span className="courier-action-icon blue"><Icon name="send" size={19} /></span>
            <span><strong>Dispatch</strong><small>Open or follow a run</small></span>
            <Icon className="courier-action-arrow" name="arrow-right" size={17} />
          </Link>
        )}
        <Link href="/parcel-org/counter?tab=labels" className="courier-action">
          <span className="courier-action-icon amber"><Icon name="tag" size={19} /></span>
            <span><strong>Labels</strong><small>Find or print labels</small></span>
          <Icon className="courier-action-arrow" name="arrow-right" size={17} />
        </Link>
      </section>

      {canImport && <CustomParcelPanel />}

      <div className="kpis dashboard-kpis">
        <div className={`kpi ${stats.awaitingDropoff > 0 ? 'a' : ''}`}>
          <span className="l">Awaiting drop-off</span>
          <span className="n">{stats.awaitingDropoff}</span>
          <span className="sub">sender bringing it in</span>
        </div>
        <div className="kpi">
          <span className="l">Ready to collect</span>
          <span className="n">{stats.awaitingPickup}</span>
          <span className="sub">waiting for a rider</span>
        </div>
        <div className="kpi">
          <span className="l">On the road</span>
          <span className="n">{stats.inTransit}</span>
          <span className="sub">picked up or in transit</span>
        </div>
        <div className={`kpi ${stats.failedDeliveries > 0 ? 'a' : ''}`}>
          <span className="l">Failed attempts</span>
          <span className="n" style={{ color: stats.failedDeliveries > 0 ? 'var(--amber)' : undefined }}>
            {stats.failedDeliveries}
          </span>
          <span className="sub">Somebody has to call the receiver</span>
        </div>
        <div className="kpi g">
          <span className="l">Delivered today</span>
          <span className="n">{stats.deliveredToday}</span>
        </div>
        {/* Earnings are a manager's business. A rider's session simply
            doesn't carry the capability, and core-go zeroes the figures
            before they ever reach this page — the check here only
            decides whether to draw the tile. */}
      </div>

      {needsAttention > 0 && (
        <div className="chain" style={{ background: 'var(--amber-t)', border: '1px solid #E8D2A0', color: 'var(--amber)', marginBottom: 16 }}>
          <Icon name="alert-triangle" size={18} />
          <span>
            {stats.failedDeliveries > 0 && <>{stats.failedDeliveries} parcel{stats.failedDeliveries === 1 ? '' : 's'} couldn’t be delivered. </>}
            {stats.atAgent > 0 && <>{stats.atAgent} sitting at a pickup point.</>}
          </span>
        </div>
      )}

      {/* Only a manager handles cash — the same capability that gates
          earnings, because counting money in and seeing what it came to
          are the same job. */}
      {canSeeEarnings && <RiderCashPanel />}

      {/* The fleet lives on its own board under the Dispatch tab —
          runs are the unit a dispatcher thinks in, not individual
          parcels, so this dashboard doesn't host a second entry to it. */}

      <form style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          name="q" defaultValue={q ?? ''} className="mono" placeholder="Search Esoqo code or your own number"
          style={{ padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, minWidth: 220, flex: 1, maxWidth: 360 }}
        />
        <select name="status" defaultValue={status ?? ''} className="mono"
          style={{ padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }}>
          <option value="">All statuses</option>
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
        <button className="btn btn-o btn-sm" type="submit">Filter</button>
      </form>

      <OrgParcelsTable
        parcels={parcels}
        hasFilter={Boolean(status || q)}
        canDispatch={canDispatch}
        canSeeEarnings={canSeeEarnings}
      />
    </>
  );
}
