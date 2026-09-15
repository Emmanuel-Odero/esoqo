'use client';

import { useActionState } from 'react';
import { Icon } from '@esoqo/ui';
import { signIn } from './actions';

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, null);

  return (
    <form action={action} className="si-form">
      <div className="si-fld">
        <label className="si-lab" htmlFor="email">
          <Icon name="mail" size={15} />Email
        </label>
        <input className="si-inp" id="email" name="email" type="email"
          autoComplete="email" placeholder="you@example.com" required
          aria-invalid={state && !state.ok && state.field === 'email' ? true : undefined} />
      </div>

      <div className="si-fld">
        <label className="si-lab" htmlFor="pin">
          <Icon name="keypad" size={15} />PIN
        </label>
        <input className="si-inp si-mono" id="pin" name="pin" type="password"
          maxLength={6} inputMode="numeric" autoComplete="current-password"
          placeholder="000000" required
          aria-invalid={state && !state.ok && state.field === 'pin' ? true : undefined} />
        <p className="si-hint">Six-digit PIN provided by your administrator</p>
      </div>

      {state && !state.ok && (
        <div className="si-err" role="alert">
          <Icon name="alert-circle" size={16} />{state.error}
        </div>
      )}

      <button type="submit" className="si-btn" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
        <Icon name="arrow-right" size={16} />
      </button>
    </form>
  );
}
