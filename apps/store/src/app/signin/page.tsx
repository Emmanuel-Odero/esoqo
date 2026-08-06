import type { Metadata } from 'next';
import { SignInForm } from './SignInForm';
import { Icon } from '@esoko/ui';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default function SignIn() {
  return (
    <div>
      <div className="page-hero">
        <div className="wrap">
          <div className="kicker"><Icon name="shop" size={12} />Esoko Store</div>
          <h1>Sign in to your store</h1>
          <p className="sub">Manage your products, orders, and payments — all from one place.</p>
          <div className="lockup"><span className="dot" />Same credentials as the rest of Esoko</div>
        </div>
      </div>
      <div className="wrap" style={{ paddingTop: 40, paddingBottom: 60 }}>
        <div className="auth-card">
          <div className="brand">
            <span className="brand-icon"><Icon name="shop" size={18} /></span>
            <span className="brand-text">Esoko<span>.store</span></span>
          </div>
          <div className="form-header">
            <h1>Welcome back</h1>
            <p>Sign in with your phone number or email and PIN.</p>
          </div>
          <SignInForm />
        </div>
      </div>
    </div>
  );
}