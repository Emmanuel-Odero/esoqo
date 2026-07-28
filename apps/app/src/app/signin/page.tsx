import type { Metadata } from 'next';
import { Icon } from '@esoko/ui';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignIn() {
  return (
    <div className="wrap" style={{ maxWidth: 420, paddingTop: 60 }}>
      <h1 style={{ marginBottom: 8 }}>Sign in</h1>
      <p style={{ color: 'var(--tx-2)', marginBottom: 26 }}>Your phone number and PIN.</p>

      <div className="fld">
        <label className="lab" htmlFor="ph"><Icon name="phone" size={15} />Phone number</label>
        <input className="inp mono" id="ph" defaultValue="+254 7" inputMode="tel" autoComplete="tel" />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="pin"><Icon name="lock" size={15} />PIN</label>
        <input className="inp mono" id="pin" type="password" maxLength={4} inputMode="numeric" />
        <p className="hint">Four digits. Esoko will never ask you for this by call or SMS.</p>
      </div>
      <button className="btn btn-p" style={{ width: '100%' }}>
        <Icon name="arrow-right" size={16} />Sign in
      </button>

      <div className="alt">
        <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)', marginBottom: 12 }}>
          <Icon name="keypad" size={21} />
        </span>
        <h3 style={{ marginBottom: 8 }}>No smartphone with you?</h3>
        <p style={{ fontSize: '.93rem', color: 'var(--tx-2)', margin: 0 }}>
          Dial <strong className="mono" style={{ color: 'var(--navy)' }}>*483*77#</strong>.
          Everything here works from a basic handset and reaches the same record.
        </p>
      </div>
    </div>
  );
}
