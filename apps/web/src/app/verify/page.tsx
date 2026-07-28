import type { Metadata } from 'next';
import { Icon } from '@esoko/ui';
import { VerifyForm } from './VerifyForm';

export const metadata: Metadata = {
  title: 'Verify a certificate',
  description: 'Check any Esoko certificate. No account needed.',
};

/**
 * The page an institution uses BEFORE it becomes a customer.
 * No login, no call to the issuing office, four seconds.
 */
export default function VerifyPage() {
  return (
    <>
      <section className="phead">
        <div className="wrap" style={{ textAlign: 'center' }}>
          <span className="icbox" style={{ background: 'rgba(255,255,255,.12)', color: '#fff', width: 52, height: 52, borderRadius: 13, margin: '0 auto 16px' }}>
            <Icon name="shield-check" size={28} />
          </span>
          <p className="kicker" style={{ justifyContent: 'center' }}>Verify</p>
          <h1 style={{ margin: '0 auto' }}>Check a certificate</h1>
          <p className="lead" style={{ margin: '12px auto 0' }}>
            Type the code printed on any Esoko certificate. No account, no sign-in, no telephone
            call to the issuing office.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap" style={{ maxWidth: 700 }}>
          <VerifyForm />

          <h2 style={{ margin: '44px 0 16px', textAlign: 'center' }}>About this check</h2>
          <div className="grid g3">
            {([
              ['certificate', 'b', 'Where the code is', 'Bottom left of every printed certificate, next to the words “Verify at esoko.co.ke/verify”. On a phone, scan the square code instead.'],
              ['seal', 'g', 'What this proves', 'That the named body issued this record to this holder on this date, and whether it is still in force. Esoko issues none of these itself.'],
              ['alert-circle', 'r', 'If a code fails', 'Check for a mistyped character before assuming a forgery. If it still fails, the certificate was not issued through Esoko. Report a suspected forgery to verify@esoko.co.ke.'],
            ] as const).map(([icon, tone, title, body]) => (
              <div className="card" key={title}>
                <span className={`icbox icbox-${tone}`} style={{ marginBottom: 13 }}>
                  <Icon name={icon} size={20} />
                </span>
                <h3 style={{ marginBottom: 8 }}>{title}</h3>
                <p className="sub" style={{ fontSize: '.91rem', margin: 0 }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
