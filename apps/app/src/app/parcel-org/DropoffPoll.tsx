'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The dashboard's only concession to "the company should see it
 * immediately" — this is a server-rendered page with no websocket/SSE
 * channel, so "immediately" means "within one refresh interval" rather
 * than true push. A front desk screen sits on a tablet all day with
 * nobody hitting reload, so a silent periodic refresh is the pragmatic
 * fix; building a live channel for one low-traffic screen would be a
 * lot of new infrastructure for a problem 30 seconds already solves.
 * Renders nothing — it only exists to call router.refresh().
 */
export function DropoffPoll({ intervalMs = 30000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
