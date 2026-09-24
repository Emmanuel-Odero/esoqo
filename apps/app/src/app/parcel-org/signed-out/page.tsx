import type { Metadata } from 'next';
import { Icon, Logo } from '@esoqo/ui';
import { listWorkspaces } from '@/lib/workspaces';
import { enterParcelOrg } from '@/app/workspace-actions';

export const dynamic = 'force-dynamic';

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
 *
 * Unless, that is, the person IS signed in to Esoqo as themselves and
 * is on the company's books — a manager whose shift session simply
 * timed out, say. Then the door is one button, because the same
 * credential that mints a company session from the workspace switcher
 * works just as well from here. Telling somebody to go find a link
 * their own session can already open was the friction; the prose below
 * is now the fallback, not the only answer.
 */
export default async function ParcelOrgSignedOutPage() {
  const companies = (await listWorkspaces()).filter((w) => w.orgType === 'courier' && w.enterable);

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

        {companies.length > 0 ? (
          <>
            <p className="sub" style={{ marginTop: 18 }}>
              You&apos;re still signed in to Esoqo as yourself, and you&apos;re on the books of{' '}
              {companies.length === 1 ? 'this company' : 'these companies'} — start a new shift
              from here.
            </p>
            <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
              {companies.map((c) => (
                <form action={enterParcelOrg.bind(null, c.id)} key={c.key}>
                  <button type="submit" className="btn btn-p btn-block">
                    <Icon name="truck" size={16} />Open {c.name}
                  </button>
                </form>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 14 }}>
              Working a different company&apos;s desk? Use its own sign-in link —{' '}
              <span className="mono">esoqo.co.ke/parcel-co/their-company</span>.
            </p>
          </>
        ) : (
          <p className="sub" style={{ marginTop: 18 }}>
            To get back in, open your company&apos;s own sign-in link — it looks like{' '}
            <span className="mono">esoqo.co.ke/parcel-co/your-company</span>. Your manager has it,
            and it&apos;s usually saved on the depot phone.
          </p>
        )}
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
