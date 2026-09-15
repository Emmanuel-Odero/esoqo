'use client';

import { useActionState } from 'react';
import { Icon } from '@esoqo/ui';
import { changePin } from './actions';

export function SetPinForm() {
  const [state, action, pending] = useActionState(changePin, null);

  return (
    <form action={action} className="si-form">
      <div className="si-fld">
        <label className="si-lab" htmlFor="currentPin">
          <Icon name="keypad" size={15} />Current PIN
        </label>
        <input className="si-inp si-mono" id="currentPin" name="currentPin" type="password"
          maxLength={6} inputMode="numeric" autoComplete="current-password"
          placeholder="000000" required
          aria-invalid={state && !state.ok && state.field === 'currentPin' ? true : undefined} />
        <p className="si-hint">The temporary PIN from your invite email</p>
      </div>

      <div className="si-fld">
        <label className="si-lab" htmlFor="newPin">
          <Icon name="keypad" size={15} />New PIN
        </label>
        <input className="si-inp si-mono" id="newPin" name="newPin" type="password"
          maxLength={6} inputMode="numeric" autoComplete="new-password"
          placeholder="000000" required
          aria-invalid={state && !state.ok && state.field === 'newPin' ? true : undefined} />
      </div>

      <div className="si-fld">
        <label className="si-lab" htmlFor="confirmPin">
          <Icon name="keypad" size={15} />Confirm new PIN
        </label>
        <input className="si-inp si-mono" id="confirmPin" name="confirmPin" type="password"
          maxLength={6} inputMode="numeric" autoComplete="new-password"
          placeholder="000000" required
          aria-invalid={state && !state.ok && state.field === 'newPin' ? true : undefined} />
        <p className="si-hint">Six digits, chosen by you — Esoqo will never ask you for it</p>
      </div>

      {state && !state.ok && (
        <div className="si-err" role="alert">
          <Icon name="alert-circle" size={16} />{state.error}
        </div>
      )}

      <button type="submit" className="si-btn" disabled={pending}>
        {pending ? 'Saving…' : 'Set PIN'}
        <Icon name="arrow-right" size={16} />
      </button>
    </form>
  );
}
