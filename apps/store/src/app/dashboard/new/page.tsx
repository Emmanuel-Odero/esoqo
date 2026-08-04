import type { Metadata } from 'next';
import { getMyRecord, listPricingRules } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { StoreWizard } from './StoreWizard';

export const metadata: Metadata = { title: 'Open your store' };
export const dynamic = 'force-dynamic';

export default async function NewStorePage() {
  const ctx = await requireSubject();
  const [record, pricing] = await Promise.all([getMyRecord(ctx), listPricingRules(ctx)]);
  const enterprises = (record?.enterprises ?? []).map((e) => ({
    id: e.id,
    name: e.workRaw,
  }));

  if (enterprises.length === 0) {
    return (
      <div className="wrap" style={{ paddingTop: 60 }}>
        <div className="note n-amber">
          <div>
            <strong style={{ display: 'block', marginBottom: 4 }}>No business on your account yet</strong>
            <p>
              A store belongs to a business already on your Esoko record. Add one from your
              record before opening a store.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const priceMap = Object.fromEntries(
    pricing.map((p) => [
      p.key,
      { amountKes: p.amountKes ? Number(p.amountKes) : null, amountPct: p.amountPct ? Number(p.amountPct) : null },
    ]),
  );

  return (
    <div className="wrap" style={{ maxWidth: 460, paddingTop: 36, paddingBottom: 60 }}>
      <StoreWizard enterprises={enterprises} pricing={priceMap} />
    </div>
  );
}
