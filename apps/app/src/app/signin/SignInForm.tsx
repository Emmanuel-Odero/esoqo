'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import Link from 'next/link';
import { Icon } from '@esoko/ui';
import { actionSignIn } from './actions';

export function SignInForm() {
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const params = useSearchParams();

  function submit() {
    setError(null); setField(undefined);
    startTransition(async () => {
      const result = await actionSignIn({ identifier, pin });
      if (!result.ok) { setError(result.error); setField(result.field); return; }
      router.push((params.get('next') || result.data.next) as Route);
      router.refresh();
    });
  }

  return (
    <>
      <div className="fld">
        <label className="lab" htmlFor="id"><Icon name="user" size={15} />Phone number or email</label>
        <input
          className="inp" id="id" value={identifier} autoComplete="username"
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="+254 7… or you@example.com"
          aria-invalid={field === 'identifier'}
        />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="pin"><Icon name="lock" size={15} />PIN</label>
        <input
          className="inp mono" id="pin" type="password" maxLength={6} inputMode="numeric"
          autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)}
          aria-invalid={field === 'pin'}
        />
        <p className="hint">Four to six digits. Esoko will never ask you for this by call or SMS.</p>
      </div>

      {error && (
        <div className="note n-red" style={{ marginBottom: 16 }}>
          <div><p>{error}</p></div>
        </div>
      )}

      <button type="button" className="btn btn-p" style={{ width: '100%' }} disabled={pending || !identifier.trim() || !pin.trim()} onClick={submit}>
        {pending ? 'Signing in…' : 'Sign in'} <Icon name="arrow-right" size={16} />
      </button>

      <p style={{ textAlign: 'center', marginTop: 16, fontSize: '.86rem' }}>
        <Link href="/signin/set-pin" style={{ color: 'var(--blue)' }}>No PIN yet, or forgotten it? Set your PIN</Link>
      </p>
    </>
  );
}
