import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { listOrgCounterPricing } from '../actions';
import { OrgCounterClient } from './OrgCounterClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Counter — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * The company's own counter: taking a parcel in over its own desk.
 *
 * `?code=` lands here pre-loaded — from the labels register's
 * "Details" on a sticker a handler already filled in out in the
 * field.
 *
 * Booking needs dispatch; anyone else is shown the door the same way
 * the labels page does it — core-go refuses the underlying calls
 * independently, so a hand-typed URL gets nothing either.
 *
 * The volumetric divisor is read here rather than hard-coded in the
 * form so the number the clerk watches move is the same one core-go
 * will charge on. Same commercial setting both counters share.
 */
export default async function ParcelOrgCounterPage(
  { searchParams }: { searchParams: Promise<{ code?: string }> },
) {
  const { code } = await searchParams;

  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  try {
    me = await getParcelOrgMe();
  } catch (e) {
    // An expired shift session lands at the company's own door, not
    // /signin — a rider doesn't know their employer's slug, and the
    // customer sign-in is the wrong door entirely.
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }
  if (!me.capabilities.includes('parcelorg.dispatch')) redirect('/parcel-org');

  const [pricing] = await Promise.all([listOrgCounterPricing(me.org.id)]);
  const divisor = Number(process.env.PARCEL_VOLUMETRIC_DIVISOR) || 5000;

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {me.org.logoUrl ? (
            <img src={me.org.logoUrl} alt={`${me.org.name} logo`}
              style={{ height: 40, maxWidth: 140, objectFit: 'contain' }} />
          ) : null}
          <div>
            <h1>Counter</h1>
            <p>
              Scan one of {me.org.name}&apos;s labels, or start from blank. Stop wherever the
              moment allows — a record saved against a label is resumable by whoever handles
              the box next, and only becomes a booking when there is a sender, a receiver
              and a route.
            </p>
          </div>
        </div>
      </div>
      <OrgCounterClient initialCode={code} pricing={pricing} volumetricDivisor={divisor} />
    </>
  );
}
