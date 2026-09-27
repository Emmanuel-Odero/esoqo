import type { Metadata } from 'next';
import { TargetClient } from '../TargetClient';

export const metadata: Metadata = {
  title: 'Pay a group — Esoqo',
  description: 'Pay into a chama, table-banking group, SACCO or co-operative by M-Pesa.',
  robots: { index: true, follow: true },
};

/**
 * /pay/group — search narrowed to group kinds, so a member looking for
 * their chama is not offered a warehouse, and then the ordinary pay flow.
 */
export default function PayGroupPage() {
  return <TargetClient mode="group" />;
}
