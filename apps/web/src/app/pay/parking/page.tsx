import type { Metadata } from 'next';
import { ParkingClient } from './ParkingClient';

export const metadata: Metadata = {
  title: 'Pay for parking — Esoqo',
  description: 'Scan a car park’s code, get a ticket by text, and pay for your stay by M-Pesa.',
  robots: { index: true, follow: true },
};

/**
 * /pay/parking — the entry point, for somebody who has not scanned
 * anything yet. A lot's own QR deep-links straight past this to
 * /pay/parking/<PRK code>; this page exists for the driver who has the
 * code written on a sign and no camera to hand.
 */
export default function PayParkingPage() {
  return <ParkingClient initialLotCode={null} initialTicketCode={null} />;
}
