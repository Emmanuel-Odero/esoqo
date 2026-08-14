import type { Metadata } from 'next';
import { SetPinForm } from './SetPinForm';

export const metadata: Metadata = { title: 'Set your PIN' };

export default function SetPinPage() {
  return (
    <div className="authwrap">
      <p className="kick">Secure your account</p>
      <h1 style={{ fontSize: '1.6rem', color: 'var(--ink)', margin: '12px 0 22px' }}>Set your PIN</h1>
      <div className="card">
        <SetPinForm />
      </div>
    </div>
  );
}
