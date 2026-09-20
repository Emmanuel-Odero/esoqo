'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { changeMyOrgPin } from '../../actions';

/**
 * Your own PIN, changed by you — the "temp PIN in, chosen PIN out"
 * half of the invite flow. Invited with a temporary PIN over SMS?
 * Change it here the moment you're signed in. One change covers both
 * doors (this portal and /signin), so there is never a second PIN to
 * remember.
 */
export function ChangePinPanel() {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const announce = useAnnounce();

  function digitsOnly(v: string) {
    return v.replace(/\D/g, '').slice(0, 6);
  }

  function save() {
    setError(null);
    setDone(false);
    if (newPin.length < 4) { setError('New PIN needs at least 4 digits.'); return; }
    if (newPin !== confirmPin) { setError('The two new PINs don’t match.'); return; }
    startTransition(async () => {
      const res = await changeMyOrgPin(currentPin, newPin);
      if (!res.ok) { setError(res.error); return; }
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setDone(true);
      announce('Your PIN has been changed', 'assertive');
    });
  }

  return (
    <section className="ppanel porg-pin">
      <div className="ppanel-head">
        <div>
          <h2>Change your PIN</h2>
          <p>Works at both doors — this portal and /signin — from the moment you save it.</p>
        </div>
      </div>
      <div className="ppanel-body">
        <div className="porg-pin-fields">
          <label className="pfield"><span>Current PIN</span>
            <input type="password" inputMode="numeric" className="mono" autoComplete="current-password"
              value={currentPin} placeholder="••••"
              onChange={(e) => setCurrentPin(digitsOnly(e.target.value))} />
          </label>
          <label className="pfield"><span>New PIN</span>
            <input type="password" inputMode="numeric" className="mono" autoComplete="new-password"
              value={newPin} placeholder="••••"
              onChange={(e) => setNewPin(digitsOnly(e.target.value))} />
            <em className="phint">4–6 digits. Not 1234, and not a run.</em>
          </label>
          <label className="pfield"><span>Repeat the new PIN</span>
            <input type="password" inputMode="numeric" className="mono" autoComplete="new-password"
              value={confirmPin} placeholder="••••"
              onChange={(e) => setConfirmPin(digitsOnly(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
          </label>
        </div>

        {error && (
          <p role="alert" className="pnote pnote-bad" style={{ marginTop: 'var(--sp-4)' }}>
            <Icon name="alert-circle" size={16} /><span>{error}</span>
          </p>
        )}
        {done && (
          <p role="status" className="pnote pnote-ok" style={{ marginTop: 'var(--sp-4)' }}>
            <Icon name="check-circle" size={16} />
            <span>PIN changed — use the new one next shift.</span>
          </p>
        )}

        <div className="ptoolbar" style={{ marginTop: 'var(--sp-5)', marginBottom: 0 }}>
          <button className="btn btn-p" disabled={pending || !currentPin || !newPin || !confirmPin}
            onClick={save}>
            <Icon name="key" size={16} />{pending ? 'Saving…' : 'Change PIN'}
          </button>
        </div>
      </div>
    </section>
  );
}
