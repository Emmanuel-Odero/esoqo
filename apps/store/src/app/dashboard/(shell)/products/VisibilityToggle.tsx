'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleProductVisibility } from './actions';

export function VisibilityToggle({ productId, status }: { productId: string; status: 'ACTIVE' | 'HIDDEN' }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      className="btn btn-o btn-sm"
      disabled={pending}
      onClick={() => startTransition(async () => {
        await toggleProductVisibility(productId, status === 'ACTIVE' ? 'HIDDEN' : 'ACTIVE');
        router.refresh();
      })}
    >
      {status === 'ACTIVE' ? 'Hide from store' : 'Show in store'}
    </button>
  );
}
