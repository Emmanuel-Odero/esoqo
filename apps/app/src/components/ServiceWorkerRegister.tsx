'use client';

import { useEffect } from 'react';

/**
 * Registers the hand-rolled service worker in /public/sw.js.
 *
 * Deliberately dependency-free (no Serwist/Workbox): Serwist pins the
 * build to Webpack, and this repo runs Turbopack in dev. The worker is
 * small, auditable, and versioned through its own cache names.
 *
 * Mutating requests (Server Action POSTs) are never intercepted, so this
 * can never replay a stale signature or contribution.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // In dev, Next serves from /public directly — registering is harmless
    // and lets the offline story be exercised on localhost.
    const id = window.setTimeout(() => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch(() => {
          /* private-mode or ephemeral contexts — degrade silently */
        });
    }, 400);
    return () => window.clearTimeout(id);
  }, []);

  return null;
}
