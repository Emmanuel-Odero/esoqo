'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce, VisuallyHidden } from '@esoko/a11y';
import { COUNTIES, LIVE_COUNTIES, formatMsisdn } from '@esoko/domain';
import {
  actionStart, actionSaveNames, actionSaveContact, actionSaveWork,
  actionSaveStanding, actionRequestOtp, actionVerifyOtp, actionComplete,
  actionSearchWork, type ActionResult,
} from './actions';
import { DocumentStep, PaymentStep } from './Steps';

type JoiningAs = 'me' | 'group' | 'biz' | 'inst';
type YesNoSoon = 'yes' | 'no' | 'soon';

interface Form {
  joiningAs: JoiningAs | '';
  officialName: string; knownAs: string;
  orgName: string; orgKnownAs: string; orgRole: string;
  msisdn: string; email: string; county: string; ward: string;
  workRaw: string; segment: string;
  hasRegisteredBusiness: YesNoSoon | ''; registrationNo: string;
  belongsToGroup: 'yes' | 'no' | ''; groupName: string;
  memberCount: string; hasKraPin: 'yes' | 'no' | '';
  ussdSetupChoice: 'now' | 'later' | '';
  paymentChoice: 'paid' | 'later' | '';
  wantsPriceSms: boolean; wantsReceiptSms: boolean; wantsExpirySms: boolean;
}

const EMPTY: Form = {
  joiningAs: '', officialName: '', knownAs: '', orgName: '', orgKnownAs: '', orgRole: 'Treasurer',
  msisdn: '+254 7', email: '', county: 'Nairobi', ward: '', workRaw: '', segment: '',
  hasRegisteredBusiness: '', registrationNo: '', belongsToGroup: '', groupName: '',
  memberCount: '', hasKraPin: '', ussdSetupChoice: '', paymentChoice: '',
  wantsPriceSms: false, wantsReceiptSms: true, wantsExpirySms: true,
};

const TOTAL_QUESTIONS = 7;

export function JoinFlow() {
  const announce = useAnnounce();
  const [pending, start] = useTransition();

  const [step, setStep] = useState(1);
  const [regId, setRegId] = useState<string | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [errField, setErrField] = useState<string | undefined>();

  const [hits, setHits] = useState<{ key: string; name: string }[]>([]);
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otp, setOtp] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [emailSent, setEmailSent] = useState(false);
  const [done, setDone] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  // Focus the question heading on every step change so keyboard and
  // screen-reader users land in the right place.
  useEffect(() => {
    headingRef.current?.focus();
    setError(null);
    setErrField(undefined);
  }, [step]);

  const handle = useCallback(
    (r: ActionResult<unknown>, onOk?: () => void) => {
      if (r.ok) { onOk?.(); return true; }
      setError(r.error);
      setErrField(r.field);
      announce(r.error, 'assertive');
      return false;
    },
    [announce],
  );

  /* ── step 1 ── */
  function pickJoiningAs(v: JoiningAs) {
    set('joiningAs', v);
    if (v === 'inst') { setStep(0); return; }
    start(async () => {
      const r = await actionStart({ joiningAs: v, language: 'en' });
      if (r.ok) { setRegId(r.data.id); setStep(2); announce('Question 2 of 5. Your name.'); }
      else handle(r);
    });
  }

  /* ── advance ── */
  function next() {
    if (!regId) return;
    setError(null);

    if (step === 2) {
      start(async () => {
        const r = await actionSaveNames(regId, {
          joiningAs: f.joiningAs, officialName: f.officialName, knownAs: f.knownAs,
          orgName: f.orgName, orgKnownAs: f.orgKnownAs,
          orgRole: f.orgRole as 'Treasurer',
        });
        handle(r, () => setStep(3));
      });
    } else if (step === 3) {
      start(async () => {
        const r = await actionSaveContact(regId, {
          msisdn: f.msisdn, email: f.email, county: f.county, ward: f.ward,
        });
        handle(r, () => setStep(4));
      });
    } else if (step === 4) {
      start(async () => {
        const r = await actionSaveWork(regId, { workRaw: f.workRaw, segment: f.segment });
        handle(r, () => setStep(5));
      });
    } else if (step === 5) {
      start(async () => {
        const r = await actionSaveStanding(regId, {
          joiningAs: f.joiningAs,
          hasRegisteredBusiness: f.hasRegisteredBusiness || undefined,
          registrationNo: f.registrationNo,
          belongsToGroup: f.belongsToGroup || undefined,
          groupName: f.groupName,
          memberCount: f.memberCount ? Number(f.memberCount) : undefined,
          hasKraPin: f.hasKraPin || undefined,
        });
        handle(r, () => setStep(6));
      });
    } else if (step === 6 || step === 7) {
      setStep(step + 1);
    } else if (step === 8) {
      start(async () => {
        const r = await actionComplete({
          registrationId: regId,
          ussdSetupChoice: f.ussdSetupChoice as 'now' | 'later',
          wantsPriceSms: f.wantsPriceSms,
          wantsReceiptSms: f.wantsReceiptSms,
          wantsExpirySms: f.wantsExpirySms,
          acceptedTerms: true,
        });
        handle(r, () => { setDone(true); announce('Registration sent. You have joined Esoko.', 'assertive'); });
      });
    }
  }

  /* ── work search ── */
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  function onWorkInput(v: string) {
    set('workRaw', v);
    clearTimeout(searchTimer.current);
    if (v.trim().length < 2) { setHits([]); return; }
    searchTimer.current = setTimeout(async () => {
      const res = await actionSearchWork(v);
      setHits(res);
      announce(res.length ? `${res.length} matches` : 'No listed match — Esoko is still for you');
    }, 200);
  }

  /* ── OTP ── */
  function sendOtp() {
    if (!regId) return;
    start(async () => {
      const r = await actionRequestOtp({ registrationId: regId, msisdn: f.msisdn });
      if (r.ok) {
        setOtpSent(true);
        setDevCode(r.data.devCode);
        announce('Code sent. Enter the six digits.', 'assertive');
      } else handle(r);
    });
  }

  function submitOtp(code: string) {
    if (!regId || code.length !== 6) return;
    start(async () => {
      const r = await actionVerifyOtp({ registrationId: regId, code });
      if (r.ok) { setOtpVerified(true); announce('Number confirmed.', 'assertive'); }
      else handle(r);
    });
  }

  const canSubmit =
    (f.ussdSetupChoice === 'later' || (f.ussdSetupChoice === 'now' && otpVerified))
    && f.paymentChoice !== '';

  /* ────────────────────────────── done ── */
  if (done) {
    return (
      <div className="qcard" role="status">
        <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)', width: 52, height: 52, borderRadius: 13 }}>
          <Icon name="check-circle" size={28} />
        </span>
        <h2 className="qh" style={{ marginTop: 18 }}>You have joined Esoko</h2>
        <p className="qs">
          {f.ussdSetupChoice === 'now'
            ? 'Your number is confirmed. Dial *483*77# and choose a PIN when you are ready.'
            : 'Dial *483*77# whenever you want to use your record. You will confirm your number then.'}
        </p>
        <div className="next">
          <strong style={{ color: 'var(--green)' }}>What you asked us to send</strong>
          <ol>
            {f.wantsPriceSms && <li>Market prices for {f.county} each morning.</li>}
            {f.wantsReceiptSms && <li>Receipts when money moves.</li>}
            {f.wantsExpirySms && <li>A warning before a certificate expires.</li>}
            {!f.wantsPriceSms && !f.wantsReceiptSms && !f.wantsExpirySms && (
              <li>Nothing. We will not message you unless you ask.</li>
            )}
          </ol>
        </div>
      </div>
    );
  }

  /* ────────────────────────────── institution ── */
  if (step === 0) {
    return (
      <div className="qcard">
        <h2 className="qh" ref={headingRef} tabIndex={-1}>Institutions do not register here</h2>
        <p className="qs">
          Banks, insurers, buyers, counties and agencies are set up by agreement. It takes a
          conversation about what you need to see and what you require.
        </p>
        <p className="hint">
          Write to <strong style={{ color: 'var(--navy)' }}>partners@esoko.co.ke</strong>, or see
          the institutions page for who is already connected and what each requires.
        </p>
        <div className="nav">
          <button className="btn btn-o back" onClick={() => setStep(1)}>
            <Icon name="arrow-left" size={16} /> Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pbar" role="presentation">
        {Array.from({ length: TOTAL_QUESTIONS + 1 }, (_, i) => (
          <span key={i} className={i < Math.min(step, TOTAL_QUESTIONS + 1) ? 'on' : ''} />
        ))}
      </div>
      <p className="pcount">
        {step === 8 ? 'Last step · verify and finish' : `Step ${step} of ${TOTAL_QUESTIONS}`}
      </p>

      <div className="qcard">
        {error && (
          <p className="err" role="alert" style={{ marginBottom: 14 }}>
            <Icon name="alert-circle" size={16} /> {error}
          </p>
        )}

        {/* ─── 1 ─── */}
        {step === 1 && (
          <>
            <h2 className="qh" ref={headingRef} tabIndex={-1}>Who is joining?</h2>
            <p className="qs">This decides what Esoko asks next. Nothing else changes.</p>
            <div className="opts">
              {([
                ['me', 'user', 'Myself', 'A trader, farmer, rider, fundi or anyone working on their own'],
                ['group', 'users', 'A group', 'Chama, self-help group, CBO, faith-based group, cooperative or SACCO'],
                ['biz', 'shop', 'A business', 'Registered or not — either is fine'],
                ['inst', 'gov', 'A bank, county, buyer or agency', 'Institutions are set up by agreement, not through this form'],
              ] as const).map(([v, icon, t, d]) => (
                <button key={v} type="button" className="opt"
                  aria-pressed={f.joiningAs === v}
                  onClick={() => pickJoiningAs(v)} disabled={pending}>
                  <span className="icbox"><Icon name={icon} size={18} /></span>
                  <span><span className="t">{t}</span><span className="d">{d}</span></span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ─── 2 ─── */}
        {step === 2 && (
          <>
            <h2 className="qh" ref={headingRef} tabIndex={-1}>
              {f.joiningAs === 'group' ? 'The group, and you' : 'Your name'}
            </h2>
            <p className="qs">
              Your official name has to match your papers later. The other is simply what Esoko
              calls you day to day.
            </p>

            {f.joiningAs === 'group' && (
              <>
                <div className="fld">
                  <label className="lab" htmlFor="orgName"><Icon name="users" size={15} />Official name of the group</label>
                  <input className="inp" id="orgName" value={f.orgName}
                    onChange={(e) => set('orgName', e.target.value)}
                    placeholder="As registered, or as it will be registered" />
                </div>
                <div className="fld">
                  <label className="lab" htmlFor="orgKnownAs">What people call it <span className="op">— optional</span></label>
                  <input className="inp" id="orgKnownAs" value={f.orgKnownAs}
                    onChange={(e) => set('orgKnownAs', e.target.value)} placeholder="e.g. Tumaini Ladies" />
                </div>
                <div className="fld">
                  <label className="lab" htmlFor="orgRole">Your role in the group</label>
                  <select className="inp" id="orgRole" value={f.orgRole}
                    onChange={(e) => set('orgRole', e.target.value)}>
                    <option>Chairperson</option><option>Treasurer</option>
                    <option>Secretary</option><option>Member</option>
                  </select>
                </div>
                <div className="sub2" />
              </>
            )}

            <div className="fld">
              <label className="lab" htmlFor="officialName"><Icon name="user" size={15} />Official name</label>
              <input className="inp" id="officialName" value={f.officialName}
                aria-invalid={errField === 'officialName'}
                aria-describedby="officialName-hint"
                onChange={(e) => set('officialName', e.target.value)}
                placeholder="As written on your ID" autoComplete="name" />
              <p className="hint" id="officialName-hint">
                Used only when a certificate or registration is issued in your name.
              </p>
            </div>
            <div className="fld">
              <label className="lab" htmlFor="knownAs">
                Name people know you by <span className="op">— optional</span>
              </label>
              <input className="inp" id="knownAs" value={f.knownAs}
                aria-describedby="knownAs-hint"
                onChange={(e) => set('knownAs', e.target.value)} placeholder="e.g. Mama Njeri" />
              <p className="hint" id="knownAs-hint">This is what Esoko uses in messages and on your record.</p>
            </div>
          </>
        )}

        {/* ─── 3 ─── */}
        {step === 3 && (
          <>
            <h2 className="qh" ref={headingRef} tabIndex={-1}>The number you will dial from</h2>
            <p className="qs">
              Esoko is used mainly by dialling <strong className="mono">*483*77#</strong>. Give the
              number on the handset you will dial from — your account is tied to that number.
            </p>
            <div className="fld">
              <label className="lab" htmlFor="msisdn"><Icon name="phone" size={15} />Phone number</label>
              <input className="inp mono" id="msisdn" value={f.msisdn} inputMode="tel"
                autoComplete="tel" aria-invalid={errField === 'msisdn'} aria-describedby="msisdn-hint"
                onChange={(e) => set('msisdn', e.target.value)} />
              <p className="hint" id="msisdn-hint">
                A six-digit code is sent there to confirm the line is yours. If you change handsets
                later the number stays the same, and so does your record.
              </p>
            </div>
            <div className="fld">
              <label className="lab" htmlFor="email">
                <Icon name="mail" size={15} />Email address <span className="op">— optional</span>
              </label>
              <input className="inp" id="email" type="email" value={f.email} inputMode="email"
                autoComplete="email" aria-describedby="email-hint"
                onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" />
              <p className="hint" id="email-hint">
                Used only if you ask for certificates or receipts by email. Esoko does not need one,
                and everything works without it.
              </p>
            </div>
            <div className="sub2">
              <div className="fld">
                <label className="lab" htmlFor="county"><Icon name="pin" size={15} />County</label>
                <select className="inp" id="county" value={f.county}
                  aria-describedby="county-hint" onChange={(e) => set('county', e.target.value)}>
                  {LIVE_COUNTIES.map((c) => <option key={c}>{c}</option>)}
                  <option disabled>──────────</option>
                  {COUNTIES.slice(8).map((c) => <option key={c}>{c}</option>)}
                </select>
                <p className="hint" id="county-hint">
                  Esoko works in all 47. The first eight have field officers and daily market prices today.
                </p>
              </div>
              <div className="fld">
                <label className="lab" htmlFor="ward">Ward or market <span className="op">— optional</span></label>
                <input className="inp" id="ward" value={f.ward}
                  onChange={(e) => set('ward', e.target.value)} placeholder="e.g. Gikomba, Kamukunji" />
              </div>
            </div>
          </>
        )}

        {/* ─── 4 ─── */}
        {step === 4 && (
          <>
            <h2 className="qh" ref={headingRef} tabIndex={-1}>
              {f.joiningAs === 'group' ? 'What does the group do?' : 'What do you do?'}
            </h2>
            <p className="qs">In English or Kiswahili, however you say it. Every kind of work is included.</p>
            <div className="fld">
              <label className="lab" htmlFor="work"><Icon name="search" size={15} />Search your work</label>
              <input className="inp" id="work" value={f.workRaw} autoComplete="off"
                role="combobox" aria-expanded={hits.length > 0} aria-controls="work-hits"
                aria-describedby="work-hint"
                onChange={(e) => onWorkInput(e.target.value)}
                placeholder="carpentry, mama mboga, boda, chama, kanisa, welding…" />
            </div>
            <div className="hits" id="work-hits" role="listbox" aria-label="Matching kinds of work">
              {hits.map((h) => (
                <button key={h.key} type="button" className="hit" role="option"
                  aria-selected={f.segment === h.key}
                  onClick={() => { set('workRaw', h.name); set('segment', h.key); setHits([]); }}>
                  <span>{h.name}</span><span className="yes">SELECT</span>
                </button>
              ))}
              {f.workRaw.trim().length >= 2 && hits.length === 0 && (
                <button type="button" className="hit"
                  onClick={() => { set('segment', ''); setHits([]); }}>
                  <span>Use “{f.workRaw}” — Esoko is for you too</span>
                  <span className="yes">SELECT</span>
                </button>
              )}
            </div>
            <p className="hint" id="work-hint">
              This decides which papers apply to you and which market prices you can ask for.
              It changes nothing else, and you can edit it later.
            </p>
          </>
        )}

        {/* ─── 5 ─── */}
        {step === 5 && (
          <>
            <h2 className="qh" ref={headingRef} tabIndex={-1}>Where you stand today</h2>
            <p className="qs">
              So Esoko shows you only what applies. There is no wrong answer here and nothing is required.
            </p>

            {f.joiningAs !== 'group' && (
              <fieldset style={{ border: 0, padding: 0, margin: '0 0 15px' }}>
                <legend className="lab">Do you have a registered business?</legend>
                <div className="opts">
                  {([
                    ['yes', 'Yes, it is registered', 'You have a business name or BRS certificate'],
                    ['no', 'No, not registered', 'Most people start here. Everything still works'],
                    ['soon', 'Not yet, but I want to', 'Esoko can handle the filing when you are ready'],
                  ] as const).map(([v, t, d]) => (
                    <button key={v} type="button" className="opt"
                      aria-pressed={f.hasRegisteredBusiness === v}
                      onClick={() => set('hasRegisteredBusiness', v)}>
                      <span><span className="t">{t}</span><span className="d">{d}</span></span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {f.hasRegisteredBusiness === 'yes' && (
              <div className="fld">
                <label className="lab" htmlFor="regNo">Registration number <span className="op">— optional</span></label>
                <input className="inp mono" id="regNo" value={f.registrationNo}
                  onChange={(e) => set('registrationNo', e.target.value)} placeholder="BN/2026/0000" />
                <p className="hint">Add it now or later. Esoko confirms it with the Business Registration Service.</p>
              </div>
            )}

            {f.joiningAs === 'group' ? (
              <div className="fld sub2">
                <label className="lab" htmlFor="members">How many members?</label>
                <input className="inp mono" id="members" inputMode="numeric" value={f.memberCount}
                  onChange={(e) => set('memberCount', e.target.value)} placeholder="18" />
                <p className="hint">A rough number is fine. Members join later with their own phone numbers.</p>
              </div>
            ) : (
              <fieldset className="sub2" style={{ border: 0, padding: 0 }}>
                <legend className="lab">Do you belong to a group, sacco or cooperative?</legend>
                <div className="opts">
                  {([['yes', 'Yes', 'A chama, sacco, cooperative, welfare group or association'],
                     ['no', 'No', 'You can join or start one later from the menu']] as const).map(([v, t, d]) => (
                    <button key={v} type="button" className="opt" aria-pressed={f.belongsToGroup === v}
                      onClick={() => set('belongsToGroup', v)}>
                      <span><span className="t">{t}</span><span className="d">{d}</span></span>
                    </button>
                  ))}
                </div>
                {f.belongsToGroup === 'yes' && (
                  <div className="fld" style={{ marginTop: 15 }}>
                    <label className="lab" htmlFor="groupName">Name of the group</label>
                    <input className="inp" id="groupName" value={f.groupName}
                      onChange={(e) => set('groupName', e.target.value)} placeholder="As people know it" />
                    <p className="hint">If the group is already on Esoko, its treasurer can link you to it.</p>
                  </div>
                )}
              </fieldset>
            )}
          </>
        )}

        {/* ─── 6 · documents ─── */}
        {step === 6 && regId && <DocumentStep registrationId={regId} />}

        {/* ─── 7 · payment ─── */}
        {step === 7 && regId && (
          <PaymentStep
            registrationId={regId}
            choice={f.paymentChoice}
            onChoice={(c) => set('paymentChoice', c)}
          />
        )}

        {/* ─── 8 · verify and finish ─── */}
        {step === 8 && (
          <>
            <h2 className="qh" ref={headingRef} tabIndex={-1}>Verify and finish</h2>
            <p className="qs">Two quick things, then Esoko sends this. You can leave either for later.</p>

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
                  <div className="otprow">
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
                    Esoko sends a link to confirm it. Nothing is held up waiting for you to click it.
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
                ...(f.joiningAs === 'group' ? [['Group', f.orgName || '—', 2] as const] : []),
                ['Official name', f.officialName || '—', 2],
                ...(f.knownAs ? [['Known as', f.knownAs, 2] as const] : []),
                ['USSD number', f.msisdn, 3],
                ...(f.email ? [['Email', f.email, 3] as const] : []),
                ['County', f.county + (f.ward ? ` · ${f.ward}` : ''), 3],
                ['Work', f.workRaw || '—', 4],
                ['Fee', f.paymentChoice === 'paid' ? 'Declared as paid' : f.paymentChoice === 'later' ? 'Paying later' : '—', 7],
              ].map(([k, v, go]) => (
                <div className="r" key={String(k)}>
                  <span className="k">{k}</span>
                  <span className="v">{v}</span>
                  <button className="ed" onClick={() => setStep(Number(go))}>Change</button>
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
                Nothing else is sent. Change any of these at any time from the menu, or reply STOP
                to any message.
              </p>
            </fieldset>

            <p className="hint">
              By joining you agree to Esoko’s terms and privacy notice. Nothing about you goes to a
              bank, buyer or agency unless you allow it, each time.
            </p>
          </>
        )}

        {/* ─── navigation ─── */}
        <div className="nav">
          {step > 1 && (
            <button className="btn btn-o back" onClick={() => setStep(step - 1)} disabled={pending}>
              <Icon name="arrow-left" size={16} /> Back
            </button>
          )}
          {step > 1 && (
            <button className="btn btn-p" onClick={next}
              disabled={pending || (step === 8 && !canSubmit)}
              aria-describedby={step === 8 && !canSubmit ? 'submit-gate' : undefined}>
              {step === 8 ? <><Icon name="send" size={17} /> Send my registration</> : 'Continue'}
              {pending && <VisuallyHidden>Working…</VisuallyHidden>}
            </button>
          )}
          {step === 8 && !canSubmit && (
            <VisuallyHidden>
              <span id="submit-gate">
                Answer the payment question and choose whether to set up dialling access
                now or later before sending.
              </span>
            </VisuallyHidden>
          )}
        </div>
      </div>

      <div className="alt">
        <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)', marginBottom: 12 }}>
          <Icon name="keypad" size={21} />
        </span>
        <h3 style={{ marginBottom: 8 }}>Or join without the internet</h3>
        <p style={{ fontSize: '.93rem', color: 'var(--tx-2)', margin: 0 }}>
          Dial <strong className="mono" style={{ color: 'var(--navy)' }}>*483*77#</strong> from the
          handset you want to register and answer the same questions. Esoko asks for no identity
          card, no fee and no documents either way.
        </p>
      </div>
    </>
  );
}
