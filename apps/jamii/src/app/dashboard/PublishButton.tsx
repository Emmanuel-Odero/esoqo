'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actionPublishPage } from './actions';

export function PublishButton({ pageId }: { pageId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      className="btn btn-stamp btn-sm"
      disabled={pending}
      onClick={() => startTransition(async () => {
        const result = await actionPublishPage(pageId);
        if (result.ok) router.refresh();
      })}
    >
      {pending ? 'Publishing…' : 'Publish page'}
    </button>
  );
}
