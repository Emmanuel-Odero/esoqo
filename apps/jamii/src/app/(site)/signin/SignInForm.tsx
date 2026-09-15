'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import Link from 'next/link';
import { safeRedirect } from '@esoqo/domain';
import { actionSignIn } from './actions';

export function SignInForm() {
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const params = useSearchParams();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await actionSignIn({ identifier, pin });
      if (!result.ok) { setError(result.error); return; }
      // safeRedirect, not the raw param: router.push follows an absolute
      // external URL, so this was an open redirect straight after a
      // genuine PIN entry.
      router.push(safeRedirect(params.get('next') || result.data.next, window.location.origin) as Route);
      router.refresh();
    });
  }

  return (
    <>
      <div className="field">
        <label htmlFor="identifier">Phone number or email</label>
        <input id="identifier" value={identifier} autoComplete="username"
          onChange={(e) => setIdentifier(e.target.value)} placeholder="+254 7… or you@example.com" />
      </div>
      <div className="field">
        <label htmlFor="pin">PIN</label>
        <input id="pin" className="mono" type="password" maxLength={6} inputMode="numeric"
          autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} />
        <div className="hint">Four to six digits. Esoqo will never ask you for this by call or SMS.</div>
      </div>
      {error && <p className="field-err" style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 16 }}>{error}</p>}
      <button type="button" className="btn btn-stamp btn-block" disabled={pending || !identifier.trim() || !pin.trim()} onClick={submit}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      <p style={{ textAlign: 'center', marginTop: 18, fontSize: '.86rem' }}>
        <Link href="/signin/set-pin" style={{ color: 'var(--stamp)', fontWeight: 700 }}>No PIN yet, or forgotten it? Set your PIN</Link>
      </p>
      <p style={{ textAlign: 'center', marginTop: 8, fontSize: '.86rem' }}>
        Don&rsquo;t have Our Jamii access yet?{' '}
        <Link href="/apply" style={{ color: 'var(--stamp)', fontWeight: 700 }}>Apply to join</Link>
      </p>
    </>
  );
}
