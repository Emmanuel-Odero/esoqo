'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markFulfilled } from './actions';

export function FulfilButton({ orderId }: { orderId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-o btn-sm"
      disabled={pending}
      onClick={() => startTransition(async () => { await markFulfilled(orderId); router.refresh(); })}
    >
      {pending ? 'Marking…' : 'Mark fulfilled'}
    </button>
  );
}
