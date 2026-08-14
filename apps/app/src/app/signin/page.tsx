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
        {/* h2, not h3 — this page has no h2 above it. Sized to match the
            h3 it visually replaces (see .alt in ../app.css). */}
        <h2 style={{ marginBottom: 8, fontSize: '1.04rem', fontWeight: 700 }}>No smartphone with you?</h2>
        <p style={{ fontSize: '.93rem', color: 'var(--tx-2)', margin: 0 }}>
          Dial <strong className="mono" style={{ color: 'var(--navy)' }}>*483*77#</strong>.
          Everything here works from a basic handset and reaches the same record.
        </p>
      </div>
    </div>
  );
}
