import Link from 'next/link';
import type { Route } from 'next';
import { displayKES } from '@esoqo/domain';
import { Icon } from '@esoqo/ui';
import { requireStaff } from '@/lib/session';
import { adminGo } from '@/lib/go-ticketing';
import { LiveRefresh } from '@/components/LiveRefresh';
import { ParcelsTable, type AdminParcelRow } from './ParcelsTable';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  DRAFT_PENDING_PAYMENT: 'Draft — pending payment',
  BOOKED: 'Booked',
  RECEIVED_AT_COUNTER: 'Received at counter',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'In transit',
  FAILED_DELIVERY: 'Delivery attempted',
  HELD_AT_AGENT: 'At a pickup point',
  DELIVERED: 'Delivered',
  RETURNED_TO_SENDER: 'Returned to sender',
  CANCELLED: 'Cancelled',
};

interface AdminParcelStats {
  statusCounts: Record<string, number>;
  revenueTodayKes: string;
  revenueKes: string;
  needingAssignment: number;
  overdueCollections: number;
  staleDrafts: number;
  cancelledToday: number;
  refundsOwed: number;
  overdueDeliveries: number;
  failedDeliveries: number;
  staleAtAgent: number;
  awaitingReturn: number;
  /** The receiver cannot get past the delivery code and the parcel has
   *  stopped. Its own count, not part of failedDeliveries: there the
   *  courier reached the door and nobody took the box; here the box is
   *  exactly where it should be and the person collecting it cannot
   *  prove they are that person. */
  receiverLocked: number;
  /** Self-confirmed collections whose courier pay is still held. */
  earningsHeld: number;
}

const PAGE_SIZE = 50;

export default async function ParcelsPage(
  { searchParams }: { searchParams: Promise<{ status?: string; q?: string; queue?: string; page?: string }> },
) {
  const ctx = await requireStaff();
  const canAssign = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.assign');
  const canCancel = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.cancel');
  const canRefund = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.refund');
  const canEdit = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.edit');
  const canConfirmPayment = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.confirmCashPayment');
  const { status, q, queue, page } = await searchParams;

  const pageNumber = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  if (queue) params.set('queue', queue);
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String((pageNumber - 1) * PAGE_SIZE));

  const [{ parcels, total }, stats] = await Promise.all([
    adminGo<{ parcels: AdminParcelRow[] | null; total: number }>(`/v1/admin/parcels?${params.toString()}`),
    adminGo<AdminParcelStats>('/v1/admin/parcels/stats'),
  ]);

  const inFlight = (stats.statusCounts.BOOKED ?? 0) + (stats.statusCounts.PICKED_UP ?? 0) + (stats.statusCounts.IN_TRANSIT ?? 0);

  return (
    <>
      <LiveRefresh />
      <div className="head">
        <div>
          <h1>Parcels</h1>
          <p>Every booking, including drafts abandoned before payment. Schedule a collector once a parcel is paid and BOOKED.</p>
        </div>
      </div>

      {/* Nine tiles now (grew from the original four) — the shared .kpis
          class is a fixed 4-column grid other pages rely on, so an
          auto-fit override here (rather than changing that class) is
          what keeps this page from leaving two tiles stranded alone on
          a half-empty row.

          Every tile that counts a worklist is a link to that worklist.
          A number naming a problem an operator then has to go and
          reconstruct with the filter box below is only half a feature,
          and the counts and the queues share one predicate in core-go
          (see dbx.ParcelQueues), so a tile reading 7 opens exactly 7
          rows. Revenue is the one tile that stays inert: it's a sum, not
          a pile of work. */}
      <div className="kpis" style={{ marginBottom: 22, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="kpi g">
          <span className="l">Revenue today</span>
          <span className="n">KES {displayKES(stats.revenueTodayKes)}</span>
          <span className="sub">KES {displayKES(stats.revenueKes)} all time</span>
        </div>
        <QueueTile queue="in-flight" active={queue} label="In flight" count={inFlight}
          sub="Booked, picked up or in transit" />
        <QueueTile queue="needs-collector" active={queue} label="Awaiting a collector" count={stats.needingAssignment}
          sub="Paid and booked, nobody assigned yet" tone="a" />
        <QueueTile queue="overdue-collection" active={queue} label="Overdue collections" count={stats.overdueCollections}
          sub="Past their scheduled pickup time" tone="r" />
        <QueueTile queue="refunds-owed" active={queue} label="Refunds owed" count={stats.refundsOwed}
          sub="Cancelled M-Pesa parcels awaiting a manual refund" tone="r" />
        <QueueTile queue="overdue-delivery" active={queue} label="Overdue deliveries" count={stats.overdueDeliveries}
          sub="Picked up or in transit, past their SLA deadline" tone="r" />
        {/* Split out of "overdue" on purpose: before FAILED_DELIVERY
            existed these were silently counted as courier SLA misses,
            which is both wrong (it's usually a receiver-side problem)
            and actionable in a completely different way — somebody has
            to phone the receiver, not chase the rider. */}
        <QueueTile queue="failed-delivery" active={queue} label="Failed attempts" count={stats.failedDeliveries}
          sub="Courier tried, couldn't hand over — still in their bag" tone="a" />
        <QueueTile queue="stale-at-agent" active={queue} label="Uncollected at shops" count={stats.staleAtAgent}
          sub="On a pickup-point shelf over 5 days — blocking a slot" tone="a" />
        <QueueTile queue="awaiting-return" active={queue} label="Ready to return" count={stats.awaitingReturn}
          sub="Three or more failed attempts — decide or send back" tone="r" />
        {/* The receiver-side failure, which had no tile because it had
            no state: a receiver who ran out of tries used to hit a
            Redis counter nobody could see and a parcel that quietly
            stopped. */}
        <QueueTile queue="receiver-locked" active={queue} label="Receiver locked out" count={stats.receiverLocked}
          sub="Wrong delivery code too many times — allow more tries or reissue" tone="r" />
        <QueueTile queue="earnings-held" active={queue} label="Courier pay held" count={stats.earningsHeld}
          sub="Closed by the receiver with no staff witness — review and release" tone="a" />
      </div>

      {(stats.staleDrafts > 0 || stats.overdueCollections > 0 || stats.refundsOwed > 0
        || stats.overdueDeliveries > 0 || stats.awaitingReturn > 0 || stats.staleAtAgent > 0
        || stats.receiverLocked > 0) && (
        <div className="chain" style={{ background: 'var(--amber-t)', border: '1px solid #E8D2A0', color: 'var(--amber)', marginBottom: 16 }}>
          <Icon name="alert-triangle" size={18} />
          <span>
            {stats.staleDrafts > 0 && <>{stats.staleDrafts} draft{stats.staleDrafts === 1 ? '' : 's'} abandoned over 24h ago. </>}
            {stats.overdueCollections > 0 && <>{stats.overdueCollections} scheduled collection{stats.overdueCollections === 1 ? '' : 's'} already past due. </>}
            {stats.refundsOwed > 0 && <>{stats.refundsOwed} M-Pesa refund{stats.refundsOwed === 1 ? '' : 's'} still owed. </>}
            {stats.overdueDeliveries > 0 && <>{stats.overdueDeliveries} {stats.overdueDeliveries === 1 ? 'delivery' : 'deliveries'} past SLA. </>}
            {stats.awaitingReturn > 0 && <>{stats.awaitingReturn} {stats.awaitingReturn === 1 ? 'parcel has' : 'parcels have'} failed three or more times. </>}
            {stats.staleAtAgent > 0 && <>{stats.staleAtAgent} uncollected at a pickup point over 5 days.</>}
          </span>
        </div>
      )}

      <form style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {/* The queue rides along as a hidden field so filtering within
            a queue narrows it instead of silently dropping back to
            every parcel — losing the worklist you were working is a
            nasty surprise when all you did was type a name. */}
        {queue && <input type="hidden" name="queue" value={queue} />}
        <select name="status" defaultValue={status ?? ''} className="mono" style={{ padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <input name="q" defaultValue={q ?? ''} placeholder="Search sender, receiver or code" style={{ flex: 1, minWidth: 200, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
        <button className="btn btn-o btn-sm" type="submit">Filter</button>
        {queue && <Link className="btn btn-o btn-sm" href={'/parcels' as Route}>Clear queue</Link>}
      </form>

      <ParcelsTable
        parcels={parcels ?? []} statusLabel={STATUS_LABEL}
        canAssign={canAssign} canCancel={canCancel} canRefund={canRefund} canEdit={canEdit}
        canConfirmPayment={canConfirmPayment}
        total={total} page={pageNumber} pageSize={PAGE_SIZE}
        baseQuery={{ status, q, queue }}
      />
    </>
  );
}

/**
 * A KPI tile that opens the rows it counted.
 *
 * `tone` only colours the number when there is actually something to
 * do — a red zero is noise, and a dashboard that cries wolf over an
 * empty queue trains people to stop reading it.
 */
function QueueTile({
  queue, active, label, count, sub, tone,
}: {
  queue: string; active?: string; label: string; count: number; sub: string; tone?: 'a' | 'r';
}) {
  const lit = count > 0;
  const isActive = active === queue;
  return (
    <Link
      href={`/parcels?queue=${queue}` as Route}
      className={`kpi kpi-link${lit && tone ? ` ${tone}` : ''}${isActive ? ' kpi-on' : ''}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className="l">{label}</span>
      <span className="n" style={{ color: lit && tone ? `var(--${tone === 'a' ? 'amber' : 'red'})` : undefined }}>
        {count}
      </span>
      <span className="sub">{sub}</span>
    </Link>
  );
}
