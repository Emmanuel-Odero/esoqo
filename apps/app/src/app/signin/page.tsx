import type { Metadata } from 'next';
import { Icon } from '@esoko/ui';
import { SignInForm } from './SignInForm';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default function SignIn() {
  return (
    <div className="wrap" style={{ maxWidth: 420, paddingTop: 60 }}>
      <h1 style={{ marginBottom: 8 }}>Sign in</h1>
      <p style={{ color: 'var(--tx-2)', marginBottom: 26 }}>Your phone number or email, and your PIN.</p>

      <SignInForm />

      <div className="alt">
        <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)', marginBottom: 12 }}>
          <Icon name="keypad" size={21} />
        </span>
        <h3 style={{ marginBottom: 8 }}>No smartphone with you?</h3>
        <p style={{ fontSize: '.93rem', color: 'var(--tx-2)', margin: 0 }}>
          Dial <strong className="mono" style={{ color: 'var(--navy)' }}>*483*77#</strong>.
          Everything here works from a basic handset and reaches the same record.
        </p>
      </div>
    </div>
  );
}
