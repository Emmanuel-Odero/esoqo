import type { Metadata } from 'next';
import { Icon, Logo } from '@esoko/ui';
import { SignInForm } from './SignInForm';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default function SignIn() {
  return (
    <div className="auth-wrap">
      <header className="auth-brand">
        <Logo />
      </header>
      <div className="auth-card">
        <p className="kicker">Your Esoko record</p>
        <h1>Sign in</h1>
        <p className="lead" style={{ marginTop: 6 }}>
          Good to see you — your phone number or email, and your PIN.
        </p>

        <div style={{ marginTop: 22 }}>
          <SignInForm />
        </div>
      </div>

      <div className="auth-alt">
        <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
          <Icon name="keypad" size={21} />
        </span>
        <h2>No smartphone with you?</h2>
        <p>
          Dial <strong className="mono" style={{ color: 'var(--navy)' }}>*483*77#</strong>.
          Everything here works from a basic handset and reaches the same record.
        </p>
      </div>
    </div>
  );
}
