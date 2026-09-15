'use client';

import { useEffect } from 'react';
import { Icon } from '@esoqo/ui';

/**
 * Catches a crash in any dashboard route and shows something a staff
 * member can act on, instead of Next's generic "This page couldn't
 * load" dead end. `reset()` re-renders the segment in place — for a
 * transient failure (a dropped DB connection, a schema not yet
 * migrated) that's often enough without a full reload.
 */
export default function DashboardError({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Dashboard route crashed:', error);
  }, [error]);

  return (
    <div className="card" style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center' }}>
      <span className="ico" style={{
        width: 46, height: 46, borderRadius: 12, background: 'var(--red-t)', color: 'var(--red)',
        display: 'grid', placeItems: 'center', margin: '0 auto 16px',
      }}>
        <Icon name="alert-triangle" size={22} />
      </span>
      <h2 style={{ marginBottom: 8 }}>This page hit a snag</h2>
      <p className="sub" style={{ marginBottom: 20 }}>
        Something went wrong loading this data. It's been logged — try again, and if it keeps
        happening, let the team know what page you were on.
      </p>
      {error.digest && (
        <p className="mono sub" style={{ fontSize: '.75rem', marginBottom: 20 }}>
          Error {error.digest}
        </p>
      )}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-p" onClick={() => reset()}>
          <Icon name="refresh" size={15} />Try again
        </button>
        <a className="btn btn-o" href="/">
          <Icon name="arrow-left" size={15} />Back to overview
        </a>
      </div>
    </div>
  );
}
