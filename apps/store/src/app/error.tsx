'use client';

import { useEffect } from 'react';
import { Notice } from '@esoqo/ui';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="wrap" style={{ paddingTop: 48, paddingBottom: 64, maxWidth: 640 }}>
      <Notice variant="error" title="This store hit a snag">
        <p>Please try again in a moment.</p>
      </Notice>
      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn btn-p" onClick={() => reset()}>Try again</button>
      </div>
    </div>
  );
}
