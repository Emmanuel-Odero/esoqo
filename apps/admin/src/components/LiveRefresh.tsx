'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * A worklist screen's only concession to "the next booking should show
 * up without anyone hitting reload" — these are server-rendered pages
 * with no websocket/SSE channel, so "immediately" means "within one
 * refresh interval" rather than true push. A dashboard sits open on a
 * counter or ops screen all day with nobody hitting reload, so a
 * silent periodic refresh is the pragmatic fix; building a live
 * channel for a handful of low-traffic screens would be a lot of new
 * infrastructure for a problem 20 seconds already solves. Mirrors
 * apps/app/src/app/parcel-org/DropoffPoll.tsx. Renders nothing — it
 * only exists to call router.refresh().
 */
export function LiveRefresh({ intervalMs = 20000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
