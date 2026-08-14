'use client';

import { useEffect, useState } from 'react';

/**
 * A slim, fixed status strip shown while the device is offline.
 *
 * The record stays readable because the service worker serves the last
 * visited pages from cache — this banner is the honest companion to that:
 * it says clearly that what is on screen is what was last synced, and
 * that nothing you type will be lost to the void (writes simply won't
 * be possible until the connection returns).
 */
export function ConnectivityBanner() {
  const [state, setState] = useState<'online' | 'offline' | 'unknown'>('unknown');

  useEffect(() => {
    const goOnline = () => setState('online');
    const goOffline = () => setState('offline');
    setState(navigator.onLine ? 'online' : 'offline');
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (state !== 'offline') return null;

  return (
    <div className="conn-banner" role="status">
      <svg width="16" height="16" aria-hidden="true" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8a15 15 0 0118 0M6.5 11.5a10 10 0 0111 0M9.5 15a5 5 0 015 0M12 19v.01" />
      </svg>
      <span>You are offline. Showing what you last saw — it will refresh when you reconnect.</span>
    </div>
  );
}
