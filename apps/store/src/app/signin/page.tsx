import type { Metadata } from 'next';
import { SignInForm } from './SignInForm';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/** Same phone/email + PIN identity as the rest of Esoko — a store belongs to an
 *  Enterprise, which belongs to the Party signing in here. */
export default function SignIn() {
  return (
    <div className="wrap" style={{ maxWidth: 420, paddingTop: 60 }}>
      <h1 style={{ marginBottom: 8 }}>Sign in</h1>
      <p style={{ color: 'var(--tx-2)', marginBottom: 26 }}>
        Your Esoko phone number or email, and your PIN — same as everywhere else on Esoko.
      </p>
      <SignInForm />
    </div>
  );
}
