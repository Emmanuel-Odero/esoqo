import { requireStaff } from '@/lib/session';
import { actionListCouriers } from '../actions';
import { CouriersTable } from './CouriersTable';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  PENDING_VETTING: 'Pending vetting',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  REJECTED: 'Rejected',
};

export default async function ParcelCouriersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireStaff();
  const canManage = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.couriers.manage');
  const { status, q } = await searchParams;

  const couriers = await actionListCouriers(status, q);
  const pendingCount = couriers.filter((c) => c.Status === 'PENDING_VETTING').length;

  return (
    <>
      <div className="head">
        <div>
          <h1>Couriers</h1>
          <p>
            The vetted, formal courier role — distinct from any signed-in Esoqo user. A courier only
            shows up in the assign panel or the claim-a-job flow once they&apos;re Active here.
          </p>
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 22 }}>
        <div className="kpi">
          <span className="l">Total couriers</span>
          <span className="n">{couriers.length}</span>
        </div>
        <div className={`kpi ${pendingCount > 0 ? 'a' : ''}`}>
          <span className="l">Pending vetting</span>
          <span className="n" style={{ color: pendingCount > 0 ? 'var(--amber)' : undefined }}>{pendingCount}</span>
          <span className="sub">Onboarded, not yet activated</span>
        </div>
        <div className="kpi g">
          <span className="l">Active</span>
          <span className="n">{couriers.filter((c) => c.Status === 'ACTIVE').length}</span>
        </div>
      </div>

      <form style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <select name="status" defaultValue={status ?? ''} className="mono" style={{ padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <input name="q" defaultValue={q ?? ''} placeholder="Search name or phone" style={{ flex: 1, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
        <button className="btn btn-o btn-sm" type="submit">Filter</button>
      </form>

      <CouriersTable couriers={couriers} statusLabel={STATUS_LABEL} canManage={canManage} />
    </>
  );
}
