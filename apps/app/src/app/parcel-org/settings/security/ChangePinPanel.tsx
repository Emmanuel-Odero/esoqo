'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { changeMyOrgPin } from '../../actions';

const inputStyle: React.CSSProperties = {
  width: '100%', marginTop: 4, padding: '8px 10px',
  border: '1.5px solid var(--line)', borderRadius: 6,
};

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
    <div className="card" style={{ padding: 16, maxWidth: 460 }}>
      <strong style={{ display: 'block', marginBottom: 4 }}>Change your PIN</strong>
      <p className="sub" style={{ margin: '0 0 12px', fontSize: '.82rem' }}>
        Works at both doors — this portal and /signin — from the moment you save it.
      </p>
      <div style={{ display: 'grid', gap: 10 }}>
        <label className="sub">Current PIN
          <input type="password" inputMode="numeric" className="mono" style={inputStyle}
            value={currentPin} placeholder="••••"
            onChange={(e) => setCurrentPin(digitsOnly(e.target.value))} />
        </label>
        <label className="sub">New PIN (4–6 digits, not 1234 or a run)
          <input type="password" inputMode="numeric" className="mono" style={inputStyle}
            value={newPin} placeholder="••••"
            onChange={(e) => setNewPin(digitsOnly(e.target.value))} />
        </label>
        <label className="sub">Repeat the new PIN
          <input type="password" inputMode="numeric" className="mono" style={inputStyle}
            value={confirmPin} placeholder="••••"
            onChange={(e) => setConfirmPin(digitsOnly(e.target.value))}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
        </label>
        <button className="btn btn-p btn-sm" disabled={pending || !currentPin || !newPin || !confirmPin}
          onClick={save} style={{ justifySelf: 'start' }}>
          {pending ? 'Saving…' : 'Change PIN'}
        </button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--red)', margin: '10px 0 0' }}>{error}</p>}
      {done && (
        <p role="status" className="chain ok" style={{ margin: '10px 0 0' }}>
          <Icon name="check-circle" size={14} />PIN changed — use the new one next shift.
        </p>
      )}
    </div>
  );
}
