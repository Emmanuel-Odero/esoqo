import { Icon } from '@esoko/ui';
import { listAllOrdersForStaff } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { DonutChart } from '@/components/charts';
import { OrderDesk } from './OrderDesk';

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Pending payment', PAID: 'Paid', FULFILLED: 'Fulfilled', CANCELLED: 'Cancelled',
};
const STATUS_COLOR: Record<string, string> = {
  PENDING_PAYMENT: 'var(--amber)', PAID: 'var(--blue)', FULFILLED: 'var(--green-2)', CANCELLED: 'var(--red)',
};

export const dynamic = 'force-dynamic';

const STATUSES = [
  ['', 'All statuses'], ['PENDING_PAYMENT', 'Pending payment'], ['PAID', 'Paid'],
  ['FULFILLED', 'Fulfilled'], ['CANCELLED', 'Cancelled'],
] as const;

export default async function OrdersPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; reroute?: string; q?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const canReroute = ctx.capabilities.includes('*') || ctx.capabilities.includes('order.reroute');

  const { rows, total } = await listAllOrdersForStaff(ctx, {
    status: (sp.status || undefined) as never,
    needsReroute: sp.reroute === '1' ? true : undefined,
    search: sp.q, take: 100,
  });
  const needingReroute = rows.filter((o) => o.needsReroute).length;
  const byStatus = new Map<string, number>();
  for (const o of rows) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);

  return (
    <>
      <div className="head">
        <div>
          <h1>Orders</h1>
          <p>
            Every order across every store — who ordered, from which shop, and what to do if that
            shop can't fulfil it.
          </p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi g">
          <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}><Icon name="basket" size={16} /></span>
          <span className="n">{total}</span><span className="l">Orders shown</span>
        </div>
        <div className="kpi r">
          <span className="ico" style={{ background: 'var(--red-t)', color: 'var(--red)' }}><Icon name="alert-triangle" size={16} /></span>
          <span className="n">{needingReroute}</span><span className="l">Flagged for reroute</span>
        </div>
      </div>

      {byStatus.size > 0 && (
        <div className="card" style={{ marginBottom: 22 }}>
          <h2><Icon name="basket" size={17} />Status, this page</h2>
          <DonutChart size={150}
            segments={[...byStatus.entries()].map(([status, count]) => ({
              label: STATUS_LABEL[status] ?? status, value: count, color: STATUS_COLOR[status] ?? 'var(--tx-3)',
            }))} />
        </div>
      )}

      <div className="ctl">
        <form className="srch" style={{ display: 'contents' }}>
          <div className="srch">
            <span className="mg"><Icon name="search" size={16} /></span>
            <input className="inp" name="q" defaultValue={sp.q ?? ''} aria-label="Search orders" placeholder="Buyer, phone or store…" />
          </div>
          <select className="inp" name="status" aria-label="Filter by status" defaultValue={sp.status ?? ''}>
            {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label className="sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" name="reroute" value="1" defaultChecked={sp.reroute === '1'} style={{ accentColor: 'var(--red)' }} />
            Flagged only
          </label>
          <button className="btn btn-o" type="submit"><Icon name="filter" size={15} />Filter</button>
        </form>
      </div>

      <OrderDesk
        rows={rows.map((o) => ({
          id: o.id, buyerName: o.buyerName, buyerMsisdn: o.buyerMsisdn,
          status: o.status, totalKes: Number(o.totalKes), createdAt: o.createdAt.toISOString(),
          store: o.store, needsReroute: o.needsReroute, rerouteReason: o.rerouteReason,
          items: o.items.map((i) => ({ productName: i.product.name, quantity: i.quantity })),
        }))}
        total={total}
        canReroute={canReroute}
      />
    </>
  );
}
