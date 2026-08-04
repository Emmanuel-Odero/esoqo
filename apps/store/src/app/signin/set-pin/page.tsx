import type { Metadata } from 'next';
import { SetPinForm } from './SetPinForm';

export const metadata: Metadata = { title: 'Set your PIN' };

export default function SetPinPage() {
  return (
    <div className="wrap" style={{ maxWidth: 420, paddingTop: 60 }}>
      <h1 style={{ marginBottom: 8 }}>Set your PIN</h1>
      <p style={{ color: 'var(--tx-2)', marginBottom: 26 }}>
        We&apos;ll text a code to your phone to confirm it&apos;s you, then you can choose a PIN.
      </p>
      <SetPinForm />
    </div>
  );
}
