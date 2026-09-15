import { Icon } from '@esoqo/ui';
import { formatKES, sumCents, toCentsOrZero } from '@esoqo/domain';
import { requireStaff } from '@/lib/session';
import { actionGetCourierTariff, actionListCouriersOwed } from '../actions';
import { PayoutConsole } from './PayoutConsole';

export const dynamic = 'force-dynamic';

/**
 * Paying the gig couriers.
 *
 * Until earnings existed, somebody could claim a job, collect a parcel,
 * carry it across town and hand it over with no record anywhere of
 * having earned a shilling. This page is the other half of fixing
 * that — what accrued has to be payable, or it is just a number on a
 * screen.
 *
 * Only couriers working directly for Esoqo appear here. A rider
 * employed by a courier company is paid by that company out of its own
 * share (Parcel.orgEarningsKes), and listing them would invite paying
 * twice for one delivery.
 */
export default async function CourierPayoutsPage() {
  const ctx = await requireStaff();
  const canEdit = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.edit');
  const canPay = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.refund');

  const [tariff, couriers] = await Promise.all([
    actionGetCourierTariff(),
    actionListCouriersOwed(),
  ]);

  const owedTotal = sumCents(couriers.map((c) => toCentsOrZero(c.owedKes)));
  const deliveries = couriers.reduce((sum, c) => sum + c.parcelCount, 0);

  return (
    <>
      <div className="head">
        <div>
          <h1>Courier payouts</h1>
          <p>
            What Esoqo&apos;s own couriers have earned and not yet been paid. Riders employed by a
            courier company aren&apos;t here — that company pays them out of its own share.
          </p>
        </div>
      </div>

      {toCentsOrZero(tariff.perDeliveryKes) === 0 && tariff.pctOfPrice === 0 && (
        <div className="chain" style={{ background: 'var(--amber-t)', border: '1px solid #E8D2A0', color: 'var(--amber)', marginBottom: 16 }}>
          <Icon name="alert-triangle" size={18} />
          <span>
            The courier rate is set to zero, so nothing is accruing on new deliveries. Set a rate
            below — couriers are still carrying parcels either way.
          </span>
        </div>
      )}

      <div className="kpis" style={{ marginBottom: 22, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className={`kpi ${owedTotal > 0 ? 'a' : ''}`}>
          <span className="l">Owed to couriers</span>
          <span className="n" style={{ color: owedTotal > 0 ? 'var(--amber)' : undefined }}>
            KES {formatKES(owedTotal)}
          </span>
          <span className="sub">Earned, not yet paid out</span>
        </div>
        <div className="kpi">
          <span className="l">Couriers waiting</span>
          <span className="n">{couriers.length}</span>
          <span className="sub">Across {deliveries} {deliveries === 1 ? 'delivery' : 'deliveries'}</span>
        </div>
      </div>

      <PayoutConsole
        tariff={tariff}
        couriers={couriers}
        canEdit={canEdit}
        canPay={canPay}
      />
    </>
  );
}
