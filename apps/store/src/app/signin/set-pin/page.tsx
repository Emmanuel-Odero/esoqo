import type { Metadata } from 'next';
import { SetPinForm } from './SetPinForm';
import { Icon } from '@esoko/ui';

export const metadata: Metadata = { title: 'Set your PIN' };

export default function SetPinPage() {
  return (
    <div>
      <div className="page-hero">
        <div className="wrap">
          <div className="kicker"><Icon name="lock" size={12} />Secure your account</div>
          <h1>Set your PIN</h1>
          <p className="sub">A PIN keeps your store and payments safe. Choose 4–6 digits you'll remember.</p>
        </div>
      </div>
      <div className="wrap" style={{ paddingTop: 40, paddingBottom: 60 }}>
        <div className="auth-card">
          <SetPinForm />
        </div>
      </div>
    </div>
  );
}