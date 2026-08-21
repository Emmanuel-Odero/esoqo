import { Icon } from '@esoko/ui';
import { listProductsForStaff } from '@esoko/db';
import { PRODUCT_CATEGORIES } from '@esoko/domain';
import { requireStaff } from '@/lib/session';
import { RankedBarChart } from '@/components/charts';
import { ProductDirectory } from './ProductDirectory';

export const dynamic = 'force-dynamic';

const STATUSES = [['', 'All statuses'], ['ACTIVE', 'Visible'], ['HIDDEN', 'Hidden by owner'], ['SUSPENDED', 'Suspended']] as const;

export default async function ProductsPage({
  searchParams,
}: { searchParams: Promise<{ category?: string; status?: string; q?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const canModerate = ctx.capabilities.includes('*') || ctx.capabilities.includes('product.moderate');

  const { rows, total } = await listProductsForStaff(ctx, {
    category: sp.category || undefined, status: (sp.status || undefined) as never, search: sp.q, take: 100,
  });

  const suspended = rows.filter((p) => p.status === 'SUSPENDED').length;
  const byCategory = new Map<string, number>();
  for (const p of rows) byCategory.set(p.category ?? 'Uncategorised', (byCategory.get(p.category ?? 'Uncategorised') ?? 0) + 1);

  return (
    <>
      <div className="head">
        <div>
          <h1>Products</h1>
          <p>
            Every listing across every store, groupable by category. Suspend anything that
            shouldn't be up, and leave the owner a note explaining why.
          </p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi g">
          <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}><Icon name="grid" size={16} /></span>
          <span className="n">{total}</span><span className="l">Products shown</span>
        </div>
        <div className="kpi r">
          <span className="ico" style={{ background: 'var(--red-t)', color: 'var(--red)' }}><Icon name="ban" size={16} /></span>
          <span className="n">{suspended}</span><span className="l">Suspended</span>
        </div>
        <div className="kpi b">
          <span className="ico" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}><Icon name="box" size={16} /></span>
          <span className="n">{byCategory.size}</span><span className="l">Categories represented</span>
        </div>
      </div>

      <div className="ctl">
        <form className="srch" style={{ display: 'contents' }}>
          <div className="srch">
            <span className="mg"><Icon name="search" size={16} /></span>
            <input className="inp" name="q" defaultValue={sp.q ?? ''} aria-label="Search products" placeholder="Product name…" />
          </div>
          <select className="inp" name="category" aria-label="Filter by category" defaultValue={sp.category ?? ''}>
            <option value="">All categories</option>
            {PRODUCT_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select className="inp" name="status" aria-label="Filter by status" defaultValue={sp.status ?? ''}>
            {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button className="btn btn-o" type="submit"><Icon name="filter" size={15} />Filter</button>
        </form>
      </div>

      {byCategory.size > 0 && (
        <div className="card" style={{ marginBottom: 22 }}>
          <h2><Icon name="box" size={17} />By category, this page</h2>
          <RankedBarChart color="var(--blue)"
            rows={[...byCategory.entries()].map(([category, count]) => ({
              label: Object.fromEntries(PRODUCT_CATEGORIES)[category] ?? category, value: count,
            }))} />
        </div>
      )}

      <ProductDirectory
        rows={rows.map((p) => ({
          id: p.id, name: p.name, category: p.category, status: p.status,
          priceKes: Number(p.priceKes), stockQty: p.stockQty,
          store: p.store, noteCount: p._count.staffNotes,
        }))}
        total={total}
        canModerate={canModerate}
        categoryLabels={Object.fromEntries(PRODUCT_CATEGORIES)}
      />
    </>
  );
}
