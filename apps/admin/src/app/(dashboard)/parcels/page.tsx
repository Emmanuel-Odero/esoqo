import { Icon } from '@esoko/ui';
import { requireStaff } from '@/lib/session';
import { adminGo } from '@/lib/go-ticketing';
import { ParcelsTable, type AdminParcelRow } from './ParcelsTable';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  DRAFT_PENDING_PAYMENT: 'Draft — pending payment',
  BOOKED: 'Booked',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

interface AdminParcelStats {
  statusCounts: Record<string, number>;
  revenueTodayKes: number;
  revenueKes: number;
  needingAssignment: number;
  overdueCollections: number;
  staleDrafts: number;
  cancelledToday: number;
  refundsOwed: number;
  overdueDeliveries: number;
}

export default async function ParcelsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireStaff();
  const canAssign = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.assign');
  const canCancel = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.cancel');
  const canRefund = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.refund');
  const canEdit = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.edit');
  const { status, q } = await searchParams;

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q) params.set('q', q);

  const [{ parcels }, stats] = await Promise.all([
    adminGo<{ parcels: AdminParcelRow[] | null }>(`/v1/admin/parcels?${params.toString()}`),
    adminGo<AdminParcelStats>('/v1/admin/parcels/stats'),
  ]);

  const inFlight = (stats.statusCounts.BOOKED ?? 0) + (stats.statusCounts.PICKED_UP ?? 0) + (stats.statusCounts.IN_TRANSIT ?? 0);

  return (
    <>
      <div className="head">
        <div>
          <h1>Parcels</h1>
          <p>Every booking, including drafts abandoned before payment. Schedule a collector once a parcel is paid and BOOKED.</p>
        </div>
      </div>

      {/* Six tiles now (grew from the original four) — the shared .kpis
          class is a fixed 4-column grid other pages rely on, so an
          auto-fit override here (rather than changing that class) is
          what keeps this page from leaving two tiles stranded alone on
          a half-empty row. */}
      <div className="kpis" style={{ marginBottom: 22, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="kpi g">
          <span className="l">Revenue today</span>
          <span className="n">KES {stats.revenueTodayKes.toLocaleString('en-KE')}</span>
          <span className="sub">KES {stats.revenueKes.toLocaleString('en-KE')} all time</span>
        </div>
        <div className="kpi">
          <span className="l">In flight</span>
          <span className="n">{inFlight}</span>
          <span className="sub">Booked, picked up or in transit</span>
        </div>
        <div className={`kpi ${stats.needingAssignment > 0 ? 'a' : ''}`}>
          <span className="l">Awaiting a collector</span>
          <span className="n" style={{ color: stats.needingAssignment > 0 ? 'var(--amber)' : undefined }}>{stats.needingAssignment}</span>
          <span className="sub">Paid and booked, nobody assigned yet</span>
        </div>
        <div className={`kpi ${stats.overdueCollections > 0 ? 'r' : ''}`}>
          <span className="l">Overdue collections</span>
          <span className="n" style={{ color: stats.overdueCollections > 0 ? 'var(--red)' : undefined }}>{stats.overdueCollections}</span>
          <span className="sub">Past their scheduled pickup time</span>
        </div>
        <div className={`kpi ${stats.refundsOwed > 0 ? 'r' : ''}`}>
          <span className="l">Refunds owed</span>
          <span className="n" style={{ color: stats.refundsOwed > 0 ? 'var(--red)' : undefined }}>{stats.refundsOwed}</span>
          <span className="sub">Cancelled M-Pesa parcels awaiting a manual refund</span>
        </div>
        <div className={`kpi ${stats.overdueDeliveries > 0 ? 'r' : ''}`}>
          <span className="l">Overdue deliveries</span>
          <span className="n" style={{ color: stats.overdueDeliveries > 0 ? 'var(--red)' : undefined }}>{stats.overdueDeliveries}</span>
          <span className="sub">Picked up or in transit, past their SLA deadline</span>
        </div>
      </div>

      {(stats.staleDrafts > 0 || stats.overdueCollections > 0 || stats.refundsOwed > 0 || stats.overdueDeliveries > 0) && (
        <div className="chain" style={{ background: 'var(--amber-t)', border: '1px solid #E8D2A0', color: 'var(--amber)', marginBottom: 16 }}>
          <Icon name="alert-triangle" size={18} />
          <span>
            {stats.staleDrafts > 0 && <>{stats.staleDrafts} draft{stats.staleDrafts === 1 ? '' : 's'} abandoned over 24h ago. </>}
            {stats.overdueCollections > 0 && <>{stats.overdueCollections} scheduled collection{stats.overdueCollections === 1 ? '' : 's'} already past due. </>}
            {stats.refundsOwed > 0 && <>{stats.refundsOwed} M-Pesa refund{stats.refundsOwed === 1 ? '' : 's'} still owed. </>}
            {stats.overdueDeliveries > 0 && <>{stats.overdueDeliveries} {stats.overdueDeliveries === 1 ? 'delivery' : 'deliveries'} past SLA.</>}
          </span>
        </div>
      )}

      <form style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <select name="status" defaultValue={status ?? ''} className="mono" style={{ padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <input name="q" defaultValue={q ?? ''} placeholder="Search sender, receiver or code" style={{ flex: 1, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
        <button className="btn btn-o btn-sm" type="submit">Filter</button>
      </form>

      <ParcelsTable parcels={parcels ?? []} statusLabel={STATUS_LABEL} canAssign={canAssign} canCancel={canCancel} canRefund={canRefund} canEdit={canEdit} />
    </>
  );
}
