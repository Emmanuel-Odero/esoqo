'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { ticketStaffSignIn } from './actions';

export function OrgStaffSignInForm({ orgSlug }: { orgSlug: string }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await ticketStaffSignIn(orgSlug, { name, pin });
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <>
      <div className="fld">
        <label className="lab" htmlFor="ts-name">Your name</label>
        <input
          className="inp" id="ts-name" autoComplete="off" placeholder="e.g. Wanjiku"
          value={name} onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="ts-pin">PIN</label>
        <input
          className="inp mono" id="ts-pin" type="password" inputMode="numeric"
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={14} />{error}</p>}
      <button
        type="button" className="btn btn-p btn-block" style={{ marginTop: 6 }}
        onClick={submit} disabled={pending || !name.trim() || pin.length < 4}
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </>
  );
}
