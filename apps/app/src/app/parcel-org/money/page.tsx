import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { RiderCashPanel } from '../RiderCashPanel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Money — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * Reconciliation — the one page where money is counted.
 *
 * The rider-float panel used to render at the bottom of the parcels
 * register, below the KPI board and above the trends strip, which made
 * the register a page about two unrelated jobs. Counting cash in is a
 * manager's end-of-shift task, not something read alongside a parcel
 * list, so it gets its own door.
 *
 * Gated on parcelorg.earnings — the same capability that decides
 * whether the dashboard draws today's takings, because counting the
 * money in and seeing what it came to are one job. core-go refuses the
 * underlying calls independently, so a hand-typed URL gets nothing.
 */
export default async function ParcelOrgMoneyPage() {
  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  try {
    me = await getParcelOrgMe();
  } catch (e) {
    // An expired shift session lands at the company's own door, not
    // /signin — that one is the customer's Esoqo account.
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }

  if (!me.capabilities.includes('parcelorg.earnings')) redirect('/parcel-org');

  return (
    <>
      <div className="head">
        <div>
          <p className="kicker">{me.org.name}</p>
          <h1>Money</h1>
          <p>Count in rider float and reconcile what the shift collected.</p>
        </div>
      </div>
      <RiderCashPanel />
    </>
  );
}
