'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@esoqo/ui';

export function CashierSignInLink({ storeSlug }: { storeSlug: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/signin/cashier/${storeSlug}`;
  const [href, setHref] = useState(path);

  // Resolved client-side — the copy button needs the full origin, but
  // the link itself works fine as a relative path either way.
  useEffect(() => { setHref(`${window.location.origin}${path}`); }, [path]);

  function copy() {
    navigator.clipboard.writeText(href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <p style={{ fontWeight: 700, fontSize: '.87rem', margin: '0 0 4px' }}>Cashier sign-in link</p>
      <p className="hint" style={{ margin: '0 0 10px' }}>
        Share this with anyone added above — they sign in with their own name and PIN, no owner account needed.
      </p>
      <div className="row">
        <code className="mono" style={{ fontSize: '.82rem', padding: '8px 12px', background: 'var(--paper)', borderRadius: 6, flex: 1, minWidth: 200, wordBreak: 'break-all' }}>
          {href}
        </code>
        <button type="button" className="btn btn-o btn-sm" onClick={copy}>
          <Icon name={copied ? 'check' : 'send'} size={13} />{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
