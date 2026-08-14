'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { actionPublishListing } from '../actions';

export function PublishControls(
  { orgId, listingId, status, canPublish }:
  { orgId: string; listingId: string; status: string; canPublish: boolean },
) {
  const [pending, start] = useTransition();
  const announce = useAnnounce();
  const router = useRouter();
  if (!canPublish) return null;

  function set(next: 'PUBLISHED' | 'SUSPENDED' | 'CANCELLED') {
    start(async () => {
      const r = await actionPublishListing(orgId, listingId, next);
      if (r.ok) { announce(`Listing ${next.toLowerCase()}.`, 'polite'); router.refresh(); }
      else announce(r.error, 'assertive');
    });
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {status !== 'PUBLISHED' && status !== 'CANCELLED' && (
        <button type="button" className="btn btn-p btn-sm" disabled={pending} onClick={() => set('PUBLISHED')}>
          <Icon name="check" size={15} />Publish
        </button>
      )}
      {status === 'PUBLISHED' && (
        <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={() => set('SUSPENDED')}>
          <Icon name="ban" size={15} />Suspend
        </button>
      )}
      {status !== 'CANCELLED' && (
        <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={() => set('CANCELLED')}>
          <Icon name="close" size={15} />Cancel listing
        </button>
      )}
    </div>
  );
}
