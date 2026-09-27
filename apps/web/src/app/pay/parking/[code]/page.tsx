import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isParkingCodeShape, PARKING_LOT_PREFIX } from '@esoqo/domain';
import { ParkingClient } from '../ParkingClient';

export const metadata: Metadata = {
  title: 'Parking — Esoqo',
  description: 'Pay for your parking by M-Pesa.',
  robots: { index: false, follow: true },
};

/**
 * One route for both printed codes.
 *
 * A car park's QR carries a PRK code and a driver's ticket carries a PRT
 * one. They are the same shape and they are both read aloud at a barrier
 * or copied out of a text message, so they arrive at the same place; the
 * prefix is what tells the two apart, and the DAL refuses to let a
 * ticket check a car out of a lot it was not issued by.
 *
 * noindex, because a ticket URL is a bearer token for one car's bill.
 * It should work when followed and should not be in a search index.
 */
export default async function ParkingCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const raw = decodeURIComponent(code);
  if (!isParkingCodeShape(raw)) notFound();

  const upper = raw.toUpperCase();
  return (
    <ParkingClient
      initialLotCode={upper.startsWith(`${PARKING_LOT_PREFIX}-`) ? upper : null}
      initialTicketCode={upper.startsWith('PRT-') ? upper : null}
    />
  );
}
