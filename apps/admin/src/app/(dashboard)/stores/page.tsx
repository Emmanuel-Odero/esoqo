import { Icon } from '@esoko/ui';
import { listPricingRules, listStoresForStaff } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { PricingRulesEditor } from './PricingRulesEditor';
import { StoreDirectory } from './StoreDirectory';

export const dynamic = 'force-dynamic';

export default async function StoresPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const canWritePricing = ctx.capabilities.includes('*') || ctx.capabilities.includes('pricing.write');
  const canModerate = ctx.capabilities.includes('*') || ctx.capabilities.includes('store.moderate');

  const [rules, { rows, total }] = await Promise.all([
    listPricingRules(ctx),
    listStoresForStaff(ctx, { status: sp.status as never, search: sp.q, take: 50 }),
  ]);

  const live = rows.filter((r) => r.status === 'ACTIVE').length;

  return (
    <>
      <div className="head">
        <div>
          <h1>Stores &amp; pricing</h1>
          <p>
            Every price a merchant sees in the store wizard reads from the rules below — nothing
            is hardcoded. Changes apply immediately and are recorded in the audit log.
          </p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi g">
          <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}><Icon name="shop" size={16} /></span>
          <span className="n">{live}</span><span className="l">Live stores</span>
        </div>
        <div className="kpi b">
          <span className="ico" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}><Icon name="basket" size={16} /></span>
          <span className="n">{total}</span><span className="l">Total stores</span>
        </div>
        <div className="kpi a">
          <span className="ico" style={{ background: 'var(--amber-t)', color: 'var(--amber)' }}><Icon name="keypad" size={16} /></span>
          <span className="n">{rows.filter((r) => r.posEnabled).length}</span><span className="l">With PoS enabled</span>
        </div>
      </div>

      {!canWritePricing && (
        <div className="chain" style={{ background: 'var(--blue-t)', border: '1px solid #C8DDEC', color: 'var(--blue)' }}>
          <Icon name="info" size={18} />
          <span>
            You can see pricing rules but not change them. Editing requires the{' '}
            <code className="mono">pricing.write</code> permission.
          </span>
        </div>
      )}

      <h2 style={{ fontSize: '1.05rem', marginBottom: 10 }}>Pricing rules</h2>
      <PricingRulesEditor
        rules={rules.map((r) => ({
          key: r.key, label: r.label,
          amountKes: r.amountKes ? Number(r.amountKes) : null,
          amountPct: r.amountPct ? Number(r.amountPct) : null,
          billingPeriod: r.billingPeriod,
          updatedAt: r.updatedAt.toISOString(),
        }))}
        canEdit={canWritePricing}
      />

      <h2 style={{ fontSize: '1.05rem', margin: '28px 0 10px' }}>Store directory</h2>
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
