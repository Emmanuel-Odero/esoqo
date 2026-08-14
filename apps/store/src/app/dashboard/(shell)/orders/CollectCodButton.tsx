'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markCodPaid } from './actions';

/** Cash on delivery: this button is what a merchant confirms payment
 *  with — the moment the cash is collected. Flips the order to PAID and
 *  posts the sale to the ledger, so COD never silently stays unpaid. */
export function CollectCodButton({ orderId }: { orderId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-g btn-sm"
      disabled={pending}
      onClick={() => startTransition(async () => { await markCodPaid(orderId); router.refresh(); })}
    >
      {pending ? 'Recording…' : 'Payment received'}
    </button>
  );
}