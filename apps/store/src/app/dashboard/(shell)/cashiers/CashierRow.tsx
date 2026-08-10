'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleCashier } from './actions';

export function CashierRow({ id, active }: { id: string; active: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    startTransition(async () => {
      await toggleCashier(id, !active);
      router.refresh();
    });
  }

  return (
    <button type="button" className="btn btn-o btn-sm" onClick={toggle} disabled={pending}>
      {pending ? 'Saving…' : active ? 'Deactivate' : 'Reactivate'}
    </button>
  );
}
