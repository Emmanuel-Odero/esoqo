import { Icon } from '@esoqo/ui';
import { listFeeBands } from '@esoqo/db';
import { requireStaff } from '@/lib/session';
import { FeeBandsEditor } from './FeeBandsEditor';

export const dynamic = 'force-dynamic';

export default async function TransactionFeesPage() {
  const ctx = await requireStaff();
  const canWrite = ctx.capabilities.includes('*') || ctx.capabilities.includes('pricing.write');

  const bands = await listFeeBands(ctx);

  return (
    <>
      <div className="head">
        <div>
          <h1>Transaction fees</h1>
          <p>
            What a wallet withdrawal or third-party M-Pesa payout costs, banded like Safaricom&apos;s
            own B2C tariff — cost-plus, not a guessed flat number. A bracket with no matching band is
            free by design, so deleting every band for a kind makes that whole transaction type free.
          </p>
        </div>
      </div>

      {!canWrite && (
        <div className="chain" style={{ background: 'var(--blue-t)', border: '1px solid #C8DDEC', color: 'var(--blue)' }}>
          <Icon name="info" size={18} />
          <span>
            You can see fee bands but not change them. Editing requires the{' '}
            <code className="mono">pricing.write</code> permission.
          </span>
        </div>
      )}

      <FeeBandsEditor
        bands={bands.map((b) => ({
          id: b.id,
          kind: b.kind,
          minKes: Number(b.minKes),
          maxKes: Number(b.maxKes),
          feeKes: Number(b.feeKes),
          updatedAt: b.updatedAt.toISOString(),
        }))}
        canEdit={canWrite}
      />
    </>
  );
}
