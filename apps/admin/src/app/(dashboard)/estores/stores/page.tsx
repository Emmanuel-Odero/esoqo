import { Icon } from '@esoqo/ui';
import { listStoresForStaff, getStoreCounts } from '@esoqo/db';
import { requireStaff } from '@/lib/session';
import { StoreDirectory } from './StoreDirectory';

export const dynamic = 'force-dynamic';

const STATUSES = [['', 'All statuses'], ['ACTIVE', 'Live'], ['DRAFT', 'Draft'], ['SUSPENDED', 'Suspended']] as const;

export default async function StoresPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const canModerate = ctx.capabilities.includes('*') || ctx.capabilities.includes('store.moderate');

  const [{ rows, total }, counts] = await Promise.all([
    listStoresForStaff(ctx, { status: (sp.status || undefined) as never, search: sp.q, take: 50 }),
    getStoreCounts(ctx),
  ]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Stores</h1>
          <p>
            Every merchant storefront on the platform. Open one to see its performance, or to help
            its owner troubleshoot.
          </p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi g">
          <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}><Icon name="shop" size={16} /></span>
          <span className="n">{counts.live}</span><span className="l">Live stores</span>
        </div>
        <div className="kpi b">
          <span className="ico" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}><Icon name="basket" size={16} /></span>
          <span className="n">{counts.total}</span><span className="l">Total stores</span>
        </div>
        <div className="kpi a">
          <span className="ico" style={{ background: 'var(--amber-t)', color: 'var(--amber)' }}><Icon name="keypad" size={16} /></span>
          <span className="n">{counts.posEnabled}</span><span className="l">With PoS enabled</span>
        </div>
      </div>

      <div className="ctl">
        <form className="srch" style={{ display: 'contents' }}>
          <div className="srch">
            <span className="mg"><Icon name="search" size={16} /></span>
            <input className="inp" name="q" defaultValue={sp.q ?? ''} aria-label="Search stores"
              placeholder="Store name…" />
          </div>
          <select className="inp" name="status" aria-label="Filter by status" defaultValue={sp.status ?? ''}>
            {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button className="btn btn-o" type="submit"><Icon name="filter" size={15} />Filter</button>
        </form>
      </div>

      <StoreDirectory
        rows={rows.map((s) => ({
          id: s.id, name: s.name, slug: s.slug, status: s.status,
          routingMode: s.routingMode, posEnabled: s.posEnabled,
          owner: s.enterprise.party.person?.knownAs || s.enterprise.party.person?.officialName
            || s.enterprise.party.organisation?.knownAs || s.enterprise.party.organisation?.officialName || '—',
          productCount: s._count.products, orderCount: s._count.orders,
        }))}
        total={total}
        canModerate={canModerate}
      />
    </>
  );
}
