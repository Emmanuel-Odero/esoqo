import { Icon } from '@esoko/ui';
import { listParcelPricingRules } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { ParcelPricingEditor } from './ParcelPricingEditor';
import { ZonesEditor } from './ZonesEditor';
import { PricingTabs } from './PricingTabs';
import { actionListParcelZones, actionGetDistanceRate } from '../actions';

export const dynamic = 'force-dynamic';

export default async function ParcelPricingPage() {
  const ctx = await requireStaff();
  const canEdit = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcel_pricing.write');

  const [rules, zones, distanceRate] = await Promise.all([
    listParcelPricingRules(ctx),
    actionListParcelZones(),
    actionGetDistanceRate(),
  ]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Parcel pricing</h1>
          <p>
            The price band and bargain rules a sender sees for each parcel type — nothing is
            hardcoded in the app. Changes apply to the next booking immediately.
          </p>
        </div>
      </div>

      {!canEdit && (
        <div className="chain" style={{ background: 'var(--blue-t)', border: '1px solid #C8DDEC', color: 'var(--blue)' }}>
          <Icon name="info" size={18} />
          <span>
            You can see parcel pricing but not change it. Editing requires the{' '}
            <code className="mono">parcel_pricing.write</code> permission.
          </span>
        </div>
      )}

      <PricingTabs
        rateCard={
          <ParcelPricingEditor
            rules={rules.map((r) => ({
              parcelType: r.parcelType,
              weightLabel: r.weightLabel,
              minWeightKg: Number(r.minWeightKg),
              maxWeightKg: Number(r.maxWeightKg),
              minKes: Number(r.minKes),
              maxKes: Number(r.maxKes),
              bargainMinPct: Number(r.bargainMinPct),
              bargainMaxPct: Number(r.bargainMaxPct),
              bargainReasons: r.bargainReasons as { reason: string; extraDiscountPct: number }[],
              suggestedTransportMode: r.suggestedTransportMode,
              slaHours: r.slaHours,
              updatedAt: r.updatedAt.toISOString(),
            }))}
            canEdit={canEdit}
          />
        }
        zones={
          <>
            <p className="sub" style={{ marginBottom: 16 }}>
              Admin-curated hubs with coordinates — the pricing/dispatch signal free-text origin
              and destination never were. A booking with both zones set gets the rate below added
              on top of its weight-bracket price, by the straight-line distance between them.
            </p>
            <ZonesEditor zones={zones} distanceRate={distanceRate} canEdit={canEdit} />
          </>
        }
      />
    </>
  );
}
