import type { Metadata } from 'next';
import { Icon, Logo } from '@esoqo/ui';

export const metadata: Metadata = {
  title: 'Signed out — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * Where an ended or expired shift session lands.
 *
 * It exists because the obvious destination is wrong: /signin is the
 * *customer's* Esoqo account, and sending a rider there would have them
 * typing a phone number into a form that can never let them back in.
 * The right door is their own company's slug — which this page can't
 * know (the session that held it is gone) and the rider may not
 * remember either, so it says plainly where to look rather than
 * pretending to route them.
 */
export default function ParcelOrgSignedOutPage() {
  return (
    <div className="auth-wrap">
      <header className="auth-brand">
        <Logo />
      </header>
      <div className="auth-card">
        <p className="kicker"><Icon name="truck" size={12} />Courier company staff</p>
        <h1>You&apos;re signed out</h1>
        <p className="lead" style={{ marginTop: 6 }}>
          Shift sessions end after 12 hours, and whenever you sign out.
        </p>
        <p className="sub" style={{ marginTop: 18 }}>
          To get back in, open your company&apos;s own sign-in link — it looks like{' '}
          <span className="mono">esoqo.co.ke/parcel-co/your-company</span>. Your manager has it,
          and it&apos;s usually saved on the depot phone.
        </p>
      </div>
      <div className="auth-alt">
        <span className="icbox" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}>
          <Icon name="box" size={21} />
        </span>
        <h2>Sending a parcel instead?</h2>
        <p>Customers book and track on <a href="/">their own Esoqo account</a>.</p>
      </div>
    </div>
  );
}
