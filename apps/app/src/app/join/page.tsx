import type { Metadata } from 'next';
import { Logo } from '@esoqo/ui';
import { JoinWizard } from './JoinWizard';

export const metadata: Metadata = { title: 'Join Esoqo' };

export default function JoinPage() {
  return (
    <div className="auth-wrap">
      <header className="auth-brand">
        <Logo />
      </header>
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <p className="kicker">New here</p>
        <h1>Join Esoqo</h1>
        <p className="lead" style={{ marginTop: 6 }}>
          Photograph your national ID and we&apos;ll fill in most of the form for you.
        </p>
        <div style={{ marginTop: 22 }}>
          <JoinWizard />
        </div>
      </div>
    </div>
  );
}
