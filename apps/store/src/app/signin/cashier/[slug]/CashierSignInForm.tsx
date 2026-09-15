'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { cashierSignIn } from './actions';

export function CashierSignInForm({ storeSlug }: { storeSlug: string }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await cashierSignIn(storeSlug, { name, pin });
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <>
      <div className="fld">
        <label className="lab" htmlFor="cs-name">Your name</label>
        <input
          className="inp" id="cs-name" autoComplete="off" placeholder="e.g. Wanjiku"
          value={name} onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="cs-pin">PIN</label>
        <input
          className="inp mono" id="cs-pin" type="password" inputMode="numeric"
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={14} />{error}</p>}
      <button
        type="button" className="btn btn-g" style={{ width: '100%', marginTop: 6 }}
        onClick={submit} disabled={pending || !name.trim() || pin.length < 4}
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </>
  );
}
