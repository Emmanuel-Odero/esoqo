import type { Metadata } from 'next';
import { ParkingFinder } from './ParkingFinder';

export const metadata: Metadata = {
  title: 'Find parking — Esoqo',
  description: 'Find a car park near you, see what it charges, and pay for your stay by M-Pesa.',
  robots: { index: true, follow: true },
};

/**
 * /parking — find somewhere to leave the car.
 *
 * Separate from /pay/parking, which is the pay-and-ticket screen for a
 * driver already parked (or standing at a booth with a code). This page
 * is the finder: search by area, or find car parks near your location.
 * Each result opens its lot's own pay screen.
 */
export default function ParkingPage() {
  return <ParkingFinder />;
}