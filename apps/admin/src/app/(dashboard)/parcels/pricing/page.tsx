import { Icon } from '@esoqo/ui';
import { listParcelPricingRules } from '@esoqo/db';
import { requireStaff } from '@/lib/session';
import { ParcelPricingEditor } from './ParcelPricingEditor';
import { ZonesEditor } from './ZonesEditor';
import { AgentsEditor } from './AgentsEditor';
import { CoverageEditor } from './CoverageEditor';
import { PricingTabs } from './PricingTabs';
import {
  actionListParcelZones, actionGetDistanceRate,
  actionListParcelAgents, actionListCoverageTiers,
} from '../actions';

export const dynamic = 'force-dynamic';

export default async function ParcelPricingPage() {
  const ctx = await requireStaff();
  const canEdit = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcel_pricing.write');
  // Pickup points and cover levels are gated on parcels.edit rather
  // than parcel_pricing.write — they're operational settings (which
  // shops are taking parcels today) as much as pricing ones, and
  // core-go enforces that same split on the routes behind them.
  const canEditOps = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.edit');

  const [rules, zones, distanceRate, agents, coverageTiers] = await Promise.all([
    listParcelPricingRules(ctx),
    actionListParcelZones(),
    actionGetDistanceRate(),
    actionListParcelAgents(),
    actionListCoverageTiers(),
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

      <PricingTabs tabs={[
        {
          id: 'rate',
          label: 'Rate card',
          content: (
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
          ),
        },
        {
          id: 'zones',
          label: 'Zones & distance pricing',
          content: (
            <>
              <p className="sub" style={{ marginBottom: 16 }}>
                Admin-curated hubs with coordinates — the pricing/dispatch signal free-text origin
                and destination never were. A booking with both zones set gets the rate below added
                on top of its weight-bracket price, by the straight-line distance between them.
              </p>
              <ZonesEditor zones={zones} distanceRate={distanceRate} canEdit={canEdit} />
            </>
          ),
        },
        {
          id: 'agents',
          label: 'Pickup points',
          content: (
            <>
              <p className="sub" style={{ marginBottom: 16 }}>
                Real shops that hold parcels for collection. One courier run serving a shop that
                twenty receivers walk to costs a fraction of twenty doorstep runs — which is why
                agent collection is priced below doorstep (set the discount per parcel type on the
                rate card) and why shelf capacity is enforced at booking and at drop-off.
              </p>
              <AgentsEditor agents={agents} zones={zones} canEdit={canEditOps} />
            </>
          ),
        },
        {
          id: 'coverage',
          label: 'Cover levels',
          content: (
            <>
              <p className="sub" style={{ marginBottom: 16 }}>
                What a sender can buy against the declared value of their contents. Optional at
                booking and off by default.
              </p>
              <CoverageEditor tiers={coverageTiers} canEdit={canEditOps} />
            </>
          ),
        },
      ]} />
    </>
  );
}
