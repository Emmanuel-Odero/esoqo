'use client';

import type { RefObject } from 'react';
import { Icon } from '@esoko/ui';
import type { Form } from '../form';

/** Step 4 — the only screen with anything genuinely required: confirm the
 *  number (or defer it) and accept the terms. Everything else is a recap. */
export function Finish({
  f, set, headingRef, emailSent, setEmailSent, onEdit,
}: {
  f: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  // otpSent/otpVerified/otp/setOtp/devCode/sendOtp/submitOtp/pending
  // dropped — only the commented-out dialling-access (USSD) block below
  // used them.
  emailSent: boolean; setEmailSent: (v: boolean) => void;
  onEdit: (step: number) => void;
}) {
  return (
    <>
      <h2 className="qh" ref={headingRef} tabIndex={-1}>Verify and finish</h2>
      <p className="qs">One thing left, then we send this. You can leave it for later.</p>

      {/*
        Dialling access (USSD *483*77#) is not finalised yet — see
        JoinFlow's canSubmit/actionComplete, which now always sends
        `ussdSetupChoice: 'later'` so registration completes without it.
        Commented out rather than deleted so the OTP-verify UI and copy
        come back in one piece once USSD is ready.

      <div className="vblock">
        <div className="vhead">
          <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
            <Icon name="keypad" size={17} />
          </span>
          <div>
            <strong>Dialling access</strong>
            <span style={{ fontSize: '.86rem', color: 'var(--tx-2)', display: 'block' }}>
              Do you want to set up <span className="mono">*483*77#</span> now?
            </span>
          </div>
          <span className={`vstate${otpVerified ? ' ok' : otpSent ? ' pend' : ''}`}>
            {otpVerified ? 'Verified' : otpSent ? 'Code sent' :
             f.ussdSetupChoice === 'later' ? 'Doing it later' : 'Not chosen'}
          </span>
        </div>

        <div className="opts" style={{ marginTop: 14 }}>
          {([['now', 'Set it up now', 'Confirm your number with a code and you can dial straight away'],
             ['later', 'Later', 'Your account is created either way. Confirm the first time you dial']] as const)
            .map(([v, t, d]) => (
            <button key={v} type="button" className="opt" aria-pressed={f.ussdSetupChoice === v}
              onClick={() => set('ussdSetupChoice', v)}>
              <span><span className="t">{t}</span><span className="d">{d}</span></span>
            </button>
          ))}
        </div>

        {f.ussdSetupChoice === 'now' && (
          <div className="sub2">
            <p className="hint sure" style={{ margin: 0 }}>
              <Icon name="shield" size={15} /> This proves the number is yours — nobody can register on your behalf.
            </p>
            <div className="otprow" style={{ marginTop: 12 }}>
              <div>
                <span className="lab" style={{ marginBottom: 3 }}>Code to</span>
                <span className="mono" style={{ fontWeight: 600 }}>{f.msisdn}</span>
              </div>
              <button type="button" className="btn btn-o" onClick={sendOtp}
                disabled={pending || otpVerified}>
                <Icon name="send" size={15} />{otpSent ? 'Resend' : 'Send code'}
              </button>
            </div>

            {otpSent && !otpVerified && (
              <div style={{ marginTop: 14 }}>
                <label className="lab" htmlFor="otp">Enter the six digits</label>
                <input className="inp mono otpfield" id="otp" inputMode="numeric" maxLength={6}
                  autoComplete="one-time-code" value={otp}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '');
                    setOtp(v);
                    if (v.length === 6) submitOtp(v);
                  }} placeholder="000000" />
                <p className="hint">Sent by SMS. It arrives within a minute.</p>
                {devCode && (
                  <p className="hint" style={{ color: 'var(--amber)' }}>
                    Development mode — code is <strong className="mono">{devCode}</strong>
                  </p>
                )}
              </div>
            )}

            {otpVerified && (
              <p className="hint" style={{ marginTop: 12 }}>
                <strong style={{ color: 'var(--green)' }}>Number confirmed.</strong>{' '}
                You will choose a PIN after this.
              </p>
            )}
          </div>
        )}
      </div>
      */}

      {f.email && (
        <div className="vblock">
          <div className="vhead">
            <span className="icbox"><Icon name="mail" size={17} /></span>
            <div>
              <strong>Email address</strong>
              <span style={{ fontSize: '.86rem', color: 'var(--tx-2)', display: 'block' }}>{f.email}</span>
            </div>
            <span className={`vstate${emailSent ? ' pend' : ''}`}>{emailSent ? 'Link sent' : 'Not sent'}</span>
          </div>
          <div className="otprow" style={{ marginTop: 12 }}>
            <p className="hint" style={{ margin: 0, maxWidth: '34ch' }}>
              We send a link to confirm it. Nothing is held up waiting for you to click it.
            </p>
            <button type="button" className="btn btn-o" onClick={() => setEmailSent(true)} disabled={emailSent}>
              <Icon name="send" size={15} />{emailSent ? 'Sent' : 'Send link'}
            </button>
          </div>
        </div>
      )}

      <div className="sum">
        {[
          ['Joining as', { me: 'Myself', group: 'A group', biz: 'A business', inst: '' }[f.joiningAs || 'me'], 1],
          // orgName is only set when registering a brand-new group;
          // linking to an existing one sets groupName instead — show
          // whichever is actually populated, not just the new-group case.
          ...(f.joiningAs === 'group' ? [['Group', f.orgName || f.groupName || '—', 1] as const] : []),
          ...(f.joiningAs === 'biz' ? [['Business', f.bizName || '—', 1] as const] : []),
          ['Official name', f.officialName || '—', 1],
          ...(f.knownAs ? [['Known as', f.knownAs, 1] as const] : []),
          ['USSD number', f.msisdn, 2],
          ...(f.email ? [['Email', f.email, 2] as const] : []),
          ['County', f.county + (f.ward ? ` · ${f.ward}` : ''), 2],
          ['Work', f.workRaw || '—', 2],
          ['Fee', f.paymentChoice === 'paid' ? 'Declared as paid' : 'Paying later', 3],
        ].map(([k, v, go]) => (
          <div className="r" key={String(k)}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
            <button className="ed" onClick={() => onEdit(Number(go))}>Change</button>
          </div>
        ))}
      </div>

      <fieldset className="optin" style={{ border: '1px solid var(--line)' }}>
        <legend className="h4"><Icon name="message" size={13} /> What should Esoko send you?</legend>
        <label>
          <input type="checkbox" checked={f.wantsPriceSms}
            onChange={(e) => set('wantsPriceSms', e.target.checked)} />
          <span>Market prices for my county each morning.{' '}
            <span style={{ color: 'var(--tx-3)' }}>You pick the commodities after joining.</span></span>
        </label>
        <label>
          <input type="checkbox" checked={f.wantsReceiptSms}
            onChange={(e) => set('wantsReceiptSms', e.target.checked)} />
          <span>Receipts when money moves.{' '}
            <span style={{ color: 'var(--tx-3)' }}>Recommended — this is how you know a payment went through.</span></span>
        </label>
        <label>
          <input type="checkbox" checked={f.wantsExpirySms}
            onChange={(e) => set('wantsExpirySms', e.target.checked)} />
          <span>A warning before any of my certificates expires.</span>
        </label>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          Nothing else is sent. Change any of these at any time from the menu, or reply STOP to any message.
        </p>
      </fieldset>

      <p className="hint">
        By joining you agree to CECF&rsquo;s terms of membership, and to Esoko holding your
        record under its privacy notice — that sharing is what makes these tools work. Nothing
        about you goes to a bank, buyer or agency unless you allow it, each time.
      </p>
    </>
  );
}
