'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { parcelStaffSignIn } from './actions';

export function ParcelStaffSignInForm({ orgSlug }: { orgSlug: string }) {
  const [name, setName] = useState('');
  const [esokoId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      // A successful sign-in redirects from the server action and never
      // returns — only the failure case produces a value to render.
      const result = await parcelStaffSignIn(orgSlug, { name, esokoId, pin });
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <>
      <div className="fld">
        <label className="lab" htmlFor="ps-name">Your name or Esoqo ID</label>
        <input
          className="inp" id="ps-name" autoComplete="off" placeholder="Name or johnmutu482"
          value={name} onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="ps-pin">PIN</label>
        <input
          className="inp mono" id="ps-pin" type="password" inputMode="numeric"
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={14} />{error}</p>}
      <button
        type="button" className="btn btn-p btn-block" style={{ marginTop: 6 }}
        onClick={submit} disabled={pending || (!name.trim() && !esokoId.trim()) || pin.length < 4}
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </>
  );
}
