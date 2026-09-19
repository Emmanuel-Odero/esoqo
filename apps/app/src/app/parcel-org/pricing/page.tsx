import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { listOrgPricing } from '../actions';
import { OrgPricingEditor } from './OrgPricingEditor';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Parcel rates — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * A courier company setting its own price, for the first time — nothing
 * before this let a company touch parcel_pricing_rule at all, so every
 * company was silently priced on the platform's own card whether or not
 * that matched their route or their margin.
 *
 * Manager-only (parcelorg.write), same tier as issuing a staff PIN — a
 * company's own rate is a commercial decision. core-go refuses the
 * underlying routes independently for any session without it, so a
 * hand-typed URL gets nothing either; the check here is UX.
 *
 * Deliberately narrow: a company sets min/max per parcel type, not the
 * weight bracket, bargain range or SLA — those describe the bracket
 * itself and stay platform-wide, set by Esoqo, so "Small parcel" means
 * the same weight range everywhere.
 */
export default async function ParcelOrgPricingPage() {
  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  let pricing: Awaited<ReturnType<typeof listOrgPricing>>;
  try {
    me = await getParcelOrgMe();
    if (!me.capabilities.includes('parcelorg.write')) redirect('/parcel-org');
    pricing = await listOrgPricing();
  } catch (e) {
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }

  return (
    <>
      <div className="head">
        <div>
          <p className="kicker">Counter · rate card</p>
          <h1>Parcel rates</h1>
          <p>
            Set your own price per parcel type. Leave a type alone and it stays on Esoqo&apos;s
            standard rate — this never affects any other company. Transport fares live separately
            under each ticket organiser&apos;s Fleet page.
          </p>
        </div>
      </div>

      <OrgPricingEditor pricing={pricing} />
    </>
  );
}
