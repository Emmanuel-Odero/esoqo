'use client';

import { useEffect } from 'react';

/**
 * Last-resort net for a crash in the root layout itself (outside the
 * dashboard segment's own error.tsx). Has to render its own <html>/<body>
 * since the root layout that would normally provide them is what failed.
 */
export default function GlobalError({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Root layout crashed:', error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{
        fontFamily: 'system-ui, sans-serif', background: '#F5F7FA', color: '#132436',
        display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0, padding: 24,
      }}>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <h1 style={{ fontSize: '1.3rem', marginBottom: 8 }}>Esoqo Operations is unavailable</h1>
          <p style={{ color: '#5C6F80', marginBottom: 20 }}>
            Something went wrong loading the app itself. Try again — if it persists, the team has
            been notified via the logs.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: '#0A2E4D', color: '#fff', border: 0, borderRadius: 8,
              padding: '11px 22px', fontWeight: 600, cursor: 'pointer', fontSize: '.9rem',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
