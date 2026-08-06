import { Icon } from '@esoko/ui';
import { listPricingRules } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { PricingRulesEditor } from './PricingRulesEditor';

export const dynamic = 'force-dynamic';

export default async function ResourcePricingPage() {
  const ctx = await requireStaff();
  const canWritePricing = ctx.capabilities.includes('*') || ctx.capabilities.includes('pricing.write');

  const rules = await listPricingRules(ctx);

  return (
    <>
      <div className="head">
        <div>
          <h1>Resource pricing</h1>
          <p>
            Every price a merchant sees in the store wizard reads from the rules below — nothing
            is hardcoded. Changes apply immediately and are recorded in the audit log.
          </p>
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
    </>
  );
}
