import type { Metadata } from 'next';
import { Logo } from '@esoqo/ui';
import { SetPinForm } from './SetPinForm';

export const metadata: Metadata = { title: 'Set your PIN' };

export default function SetPinPage() {
  return (
    <div className="auth-wrap">
      <header className="auth-brand">
        <Logo />
      </header>
      <div className="auth-card">
        <p className="kicker">Your Esoqo record</p>
        <h1>Set your PIN</h1>
        <p className="lead" style={{ marginTop: 6 }}>
          We&apos;ll text a code to your phone to confirm it&apos;s you, then you can choose a PIN.
        </p>
        <div style={{ marginTop: 22 }}>
          <SetPinForm />
        </div>
      </div>
    </div>
  );
}
