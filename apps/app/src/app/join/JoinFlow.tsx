'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce, VisuallyHidden } from '@esoko/a11y';
import {
  actionStart, actionSaveNames, actionSaveContact, actionSaveWork,
  actionSaveStanding, actionRequestOtp, actionVerifyOtp, actionComplete,
  actionSearchWork, actionSearchGroups, type ActionResult,
} from './actions';
import { actionDeferPayment } from './upload';
import { EMPTY, type Form } from './form';
import { WhoAndName } from './steps/WhoAndName';
import { ContactWork } from './steps/ContactWork';
import { MoreAboutYou } from './steps/MoreAboutYou';
import { Finish } from './steps/Finish';

/**
 * Four screens instead of eight. The data model never required most of
 * what the old flow forced a separate screen for — standing, documents
 * and the registration fee are genuinely optional at the schema level
 * (see packages/domain/src/registration.ts), so they're now one
 * collapsed, skippable step instead of three mandatory stops. See
 * ADR discussion: nothing here changes what's stored or how it's
 * validated — only how many screens stand between "start" and "done".
 */

const KNOWN_ROLES = ['Chairperson', 'Treasurer', 'Secretary', 'Member'] as const;
const TOTAL_STEPS = 4;
const STORAGE_KEY = 'esoko:join:v2';

export function JoinFlow() {
  const announce = useAnnounce();
  const [pending, start] = useTransition();

  const [step, setStep] = useState(1);
  const [regId, setRegId] = useState<string | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [errField, setErrField] = useState<string | undefined>();

  const [hits, setHits] = useState<{ key: string; name: string }[]>([]);
  const [groupHits, setGroupHits] = useState<{ id: string; name: string; county: string }[]>([]);
  const [orgRoleOther, setOrgRoleOther] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otp, setOtp] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [emailSent, setEmailSent] = useState(false);
  const [done, setDone] = useState(false);
  const [resumable, setResumable] = useState<{ f: Form; step: number; regId: string } | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  // Offer to resume an in-progress registration saved in this browser.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { f: Form; step: number; regId: string };
      if (saved?.regId && saved.step > 1) setResumable(saved);
    } catch { /* corrupt or inaccessible storage — ignore */ }
  }, []);

  function resume() {
    if (!resumable) return;
    setF(resumable.f);
    setStep(resumable.step);
    setRegId(resumable.regId);
    setOrgRoleOther(Boolean(resumable.f.orgRole) &&
      !KNOWN_ROLES.includes(resumable.f.orgRole as typeof KNOWN_ROLES[number]));
    setResumable(null);
  }

  function startFresh() {
    window.localStorage.removeItem(STORAGE_KEY);
    setResumable(null);
  }

  useEffect(() => {
    if (!regId || done) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ f, step, regId }));
    } catch { /* storage full or blocked — resuming just won't be offered */ }
  }, [f, step, regId, done]);

  useEffect(() => {
    if (done) {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }, [done]);

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

  function pickJoiningAs(v: Form['joiningAs']) {
    if (v === 'inst') { set('joiningAs', v); setStep(0); return; }
    set('joiningAs', v);
  }

  /* ── advance ── */
  function next() {
    setError(null);

    if (step === 1) {
      if (!f.joiningAs || f.joiningAs === 'inst') return;
      start(async () => {
        let id = regId;
        if (!id) {
          const started = await actionStart({ joiningAs: f.joiningAs, language: 'en' });
          if (!handle(started)) return;
          id = started.ok ? started.data.id : null;
          if (!id) return;
          setRegId(id);
        }
        const r = await actionSaveNames(id, {
          joiningAs: f.joiningAs, officialName: f.officialName, knownAs: f.knownAs,
          orgName: f.orgName, orgKnownAs: f.orgKnownAs,
          orgRole: f.orgRole as 'Treasurer',
        });
        handle(r, () => { setStep(2); announce('Step 2 of 4. How to reach you.'); });
      });
    } else if (step === 2) {
      if (!regId) return;
      start(async () => {
        const c = await actionSaveContact(regId, {
          msisdn: f.msisdn, email: f.email, county: f.county, ward: f.ward,
        });
        if (!handle(c)) return;
        const w = await actionSaveWork(regId, { workRaw: f.workRaw, segment: f.segment });
        handle(w, () => { setStep(3); announce('Step 3 of 4. Anything else — all optional.'); });
      });
    } else if (step === 3) {
      if (!regId) return;
      start(async () => {
        const r = await actionSaveStanding(regId, {
          joiningAs: f.joiningAs,
          hasRegisteredBusiness: f.hasRegisteredBusiness || undefined,
          registrationNo: f.registrationNo,
          belongsToGroup: f.belongsToGroup || undefined,
          groupName: f.groupName,
          groupPartyId: f.groupPartyId || undefined,
          feeCoverage: f.feeCoverage || undefined,
          memberCount: f.memberCount ? Number(f.memberCount) : undefined,
          hasKraPin: f.hasKraPin || undefined,
        });
        if (!handle(r)) return;

        // Nobody opened the payment section — that's a legitimate choice,
        // equivalent to picking "later". Don't make silence an error.
        if (f.paymentChoice === '' && f.feeCoverage !== 'group') {
          await actionDeferPayment(regId);
          set('paymentChoice', 'later');
        } else if (f.feeCoverage === 'group') {
          set('paymentChoice', 'later');
        }
        setStep(4);
        announce('Step 4 of 4. Verify and finish.');
      });
    } else if (step === 4) {
      if (!regId) return;
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
  function onSelectWork(key: string, name: string) {
    set('workRaw', name); set('segment', key); setHits([]);
  }

  /* ── group search ── */
  const groupSearchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  function onGroupInput(v: string) {
    set('groupName', v);
    set('groupPartyId', '');
    clearTimeout(groupSearchTimer.current);
    if (v.trim().length < 2) { setGroupHits([]); return; }
    groupSearchTimer.current = setTimeout(async () => {
      const res = await actionSearchGroups(v);
      setGroupHits(res);
      announce(res.length ? `${res.length} matching groups` : 'No match — you can still enter the name');
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

  const canSubmit = f.ussdSetupChoice === 'later' || (f.ussdSetupChoice === 'now' && otpVerified);

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
      {resumable && step === 1 && (
        <div className="qcard" role="status" style={{ marginBottom: 14 }}>
          <p className="qs" style={{ margin: 0 }}>
            You have a registration in progress from this device
            {resumable.f.officialName ? `, started as ${resumable.f.officialName}` : ''}.
          </p>
          <div className="nav" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-o" onClick={startFresh}>Start over</button>
            <button type="button" className="btn btn-p" onClick={resume}>Continue where I left off</button>
          </div>
        </div>
      )}

      <div className="pbar" role="presentation">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <span key={i} className={i < step ? 'on' : ''} />
        ))}
      </div>
      <p className="pcount">
        {step === TOTAL_STEPS ? 'Last step · verify and finish' : `Step ${step} of ${TOTAL_STEPS}`}
      </p>

      <div className="qcard">
        {error && (
          <p className="err" role="alert" style={{ marginBottom: 14 }}>
            <Icon name="alert-circle" size={16} /> {error}
          </p>
        )}

        {step === 1 && (
          <WhoAndName
            f={f} set={set} headingRef={headingRef}
            orgRoleOther={orgRoleOther} setOrgRoleOther={setOrgRoleOther}
            errField={errField} onPickJoiningAs={pickJoiningAs}
          />
        )}

        {step === 2 && (
          <ContactWork
            f={f} set={set} headingRef={headingRef} errField={errField}
            hits={hits} onWorkInput={onWorkInput} onSelectWork={onSelectWork}
          />
        )}

        {step === 3 && regId && (
          <MoreAboutYou
            f={f} set={set} headingRef={headingRef} registrationId={regId}
            groupHits={groupHits} onGroupInput={onGroupInput}
          />
        )}

        {step === 4 && (
          <Finish
            f={f} set={set} headingRef={headingRef}
            otpSent={otpSent} otpVerified={otpVerified} otp={otp} setOtp={setOtp} devCode={devCode}
            sendOtp={sendOtp} submitOtp={submitOtp}
            emailSent={emailSent} setEmailSent={setEmailSent}
            pending={pending} onEdit={setStep}
          />
        )}

        <div className="nav">
          {step > 1 && (
            <button className="btn btn-o back" onClick={() => setStep(step - 1)} disabled={pending}>
              <Icon name="arrow-left" size={16} /> Back
            </button>
          )}
          <button className="btn btn-p" onClick={next}
            disabled={pending || (step === 1 && !f.joiningAs) || (step === TOTAL_STEPS && !canSubmit)}
            aria-describedby={step === TOTAL_STEPS && !canSubmit ? 'submit-gate' : undefined}>
            {step === TOTAL_STEPS ? <><Icon name="send" size={17} /> Send my registration</> : 'Continue'}
            {pending && <VisuallyHidden>Working…</VisuallyHidden>}
          </button>
          {step === TOTAL_STEPS && !canSubmit && (
            <VisuallyHidden>
              <span id="submit-gate">Choose whether to set up dialling access now or later before sending.</span>
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
