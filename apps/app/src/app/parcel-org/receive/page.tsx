import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  ParcelOrgUnauthorised, getParcelOrgMe, parcelOrgFetch,
  type OrgParcelRow,
} from '@/lib/parcel-org-session';
import { FrontDeskClient } from './FrontDeskClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Front desk — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * The physical hand-over moment for a self-drop-off booking.
 *
 * Everything on this page was already booked and paid for online — the
 * sender chose "I'll drop it off myself" and this company's own desk at
 * booking time (see SendParcelForm's origin-method step). What didn't
 * exist until now was a screen for the person actually standing at that
 * desk to say "I have this in hand", which is the one fact nobody could
 * record: the booking sat as BOOKED with no collector and no way to
 * become PICKED_UP short of a courier's own app.
 *
 * Confirming here calls the exact same custody-scan endpoint a courier
 * uses on their own pickup — see receiveWalkInParcel — so the existing
 * sender/receiver SMS pair fires unchanged; nothing new was composed
 * for this screen.
 */
export default async function FrontDeskPage() {
  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  let waiting: OrgParcelRow[];
  try {
    [me, { parcels: waiting }] = await Promise.all([
      getParcelOrgMe(),
      parcelOrgFetch<{ parcels: OrgParcelRow[] | null }>(
        '/v1/parcel-orgs/me/parcels?status=BOOKED&originMethod=SELF_DROPOFF',
      ).then((r) => ({ parcels: r.parcels ?? [] })),
    ]);
  } catch (e) {
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }

  if (!me.capabilities.includes('parcelorg.carry')) {
    redirect('/parcel-org');
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Front desk</h1>
          <p>
            Senders who chose to drop this off themselves. Confirm receipt the moment you have the
            box in hand — that&apos;s what tells them it arrived and gives the receiver a tracking code.
          </p>
        </div>
      </div>
      <FrontDeskClient waiting={waiting} orgName={me.org.name} orgLogoUrl={me.org.logoUrl ?? undefined} />
    </>
  );
}
