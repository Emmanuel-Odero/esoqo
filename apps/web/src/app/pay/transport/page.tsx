import type { Metadata } from 'next';
import { TargetClient } from '../TargetClient';

export const metadata: Metadata = {
  title: 'Pay a transport company — Esoqo',
  description: 'Pay a transport company by name or by number plate, with M-Pesa.',
  robots: { index: true, follow: true },
};

/**
 * /pay/transport — a company name, or the plate on the vehicle you are
 * about to board, resolved up the fleet to the company that owns it.
 */
export default function PayTransportPage() {
  return <TargetClient mode="transport" />;
}
