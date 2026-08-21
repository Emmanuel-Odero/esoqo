'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const POLL_MS = 8000;

/**
 * Keeps this Server Component page's data current while staff have it
 * open — a CECF WordPress registrant moving STARTED → AWAITING_OTP →
 * COMPLETE (or a payment landing) previously only showed up on a
 * manual reload. `router.refresh()` re-runs the page's own server-side
 * data fetch and hands the client tree fresh props without touching
 * any client-side state (RegistrationTable's open detail modal, form
 * values mid-edit, etc. all survive a refresh untouched) — no separate
 * polling endpoint or client-side data model needed.
 *
 * Paused while the tab is backgrounded, same consideration as the
 * donation live-stats poller (apps/jamii's CampaignLiveProvider).
 */
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <span className="tb-caps" style={{ gap: 6 }} title="Refreshes automatically as registrations progress">
      <span style={{
        width: 7, height: 7, borderRadius: '50%', background: 'var(--green-2)', display: 'inline-block',
        animation: 'live-pulse 1.8s ease-in-out infinite',
      }} />
      Live
    </span>
  );
}
