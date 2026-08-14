import type { Metadata } from 'next';
import { SignInForm } from './SignInForm';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default function SignInPage() {
  return (
    <div className="authwrap">
      <p className="kick">Our Jamii</p>
      <h1 style={{ fontSize: '1.6rem', color: 'var(--ink)', margin: '12px 0 22px' }}>
        Sign in to manage your organisation&rsquo;s page
      </h1>
      <div className="card">
        <p style={{ fontSize: '.86rem', color: '#6b6552', marginBottom: 20 }}>
          Same credentials as the rest of Esoko — the phone number or email your organisation registered with.
        </p>
        <SignInForm />
      </div>
    </div>
  );
}
