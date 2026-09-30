'use client';

import { useEffect, useState, useTransition } from 'react';
import { Icon, IdCardScanner } from '@esoqo/ui';
import { parseKenyanIdText, filledNationalIdFields, type ParsedNationalId } from '@esoqo/domain';
import {
  actionStartJoin, actionUploadJoinDocument, actionSendJoinOtp, actionVerifyJoinOtp,
  actionCompleteJoin, actionConfirmHandle, type JoinDetails,
} from './actions';
import { DetailsForm } from './DetailsForm';

type Step = 'capture' | 'extracting' | 'details' | 'otp' | 'pick-handle' | 'done';

/** The chama invite this signup is finishing, when there is one — read
 *  server-side from the `?i=` token in page.tsx. */
export interface JoinInvite {
  token: string;
  orgName: string;
  inviterName?: string;
  joinFeeKes: number;
  msisdn?: string;
  email?: string;
  firstName?: string;
  middleName?: string;
  surname?: string;
}

const EMPTY_DETAILS: JoinDetails = {
  firstName: '', middleName: '', surname: '', dateOfBirth: '', sex: '',
  county: '', ward: '', msisdn: '+254 7', email: '',
  idNumber: '', serialNumber: '', districtOfBirth: '', dateOfIssue: '',
};

/** Every ParsedNationalId field that has a form input behind it. Anything
 *  outside this list (placeOfIssue) is read off the card to help derive
 *  something else and never shown as its own field. */
const SCANNED_FIELDS = [
  'firstName', 'middleName', 'surname', 'dateOfBirth', 'sex',
  'county', 'districtOfBirth', 'idNumber', 'serialNumber', 'dateOfIssue',
] as const satisfies ReadonlyArray<keyof JoinDetails & keyof ParsedNationalId>;

type ScannedField = (typeof SCANNED_FIELDS)[number];

/**
 * Runs tesseract.js against a photo, client-side — no image or extracted
 * text ever leaves the browser during this step. Best-effort only: see
 * parseKenyanIdText's own doc comment for why every field this produces
 * lands in an editable input, never written straight through.
 *
 * `onProgress` is wired to tesseract's own logger because the OCR pass is
 * the one genuinely slow moment in this flow — several seconds on a mid
 * range phone, with nothing happening on screen. A bare "Reading your
 * ID…" for that long reads as a hang, and someone who reloads the page
 * loses the photos they just took.
 */
async function extractText(file: File, onProgress: (fraction: number) => void): Promise<string> {
  const { createWorker, OEM } = await import('tesseract.js');
  // LSTM_ONLY rather than the default combined engine: it reads the
  // machine-printed sans-serif on an ID card at least as well and skips
  // downloading the legacy model, which on a phone is the difference
  // between a few seconds and rather more than that.
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    logger: (m: { status: string; progress: number }) => {
      // Only the recognition phase maps onto a meaningful fraction; the
      // model download and warm-up report their own progress and would
      // otherwise make the bar run to full and restart.
      if (m.status === 'recognizing text') onProgress(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(file);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

function mergeParsed(a: ParsedNationalId, b: ParsedNationalId): ParsedNationalId {
  return { ...a, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) };
}

export function JoinWizard({ invite = null }: { invite?: JoinInvite | null }) {
  const [step, setStep] = useState<Step>('capture');
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [details, setDetails] = useState<JoinDetails>(() => initialDetails(invite));
  // Which fields the scan filled in, so the review step can mark them as
  // read-off-the-card rather than presenting OCR output and a person's own
  // typing as equally trustworthy.
  const [scanned, setScanned] = useState<Set<ScannedField>>(new Set());
  const [scanReport, setScanReport] = useState<{ read: number; ranOcr: boolean } | null>(null);
  const [progress, setProgress] = useState(0);
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [frontDocumentId, setFrontDocumentId] = useState<string | undefined>(undefined);
  const [backDocumentId, setBackDocumentId] = useState<string | undefined>(undefined);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [handleCandidates, setHandleCandidates] = useState<string[]>([]);
  const [chosenHandle, setChosenHandle] = useState<string | null>(null);
  const [esoqoId, setEsoqoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Object URLs are created here, once per file, and revoked when that
  // file is replaced or the wizard unmounts — a URL minted during render
  // leaks one per re-render, and the previews outlive several steps.
  const frontPreview = useObjectUrl(frontFile);
  const backPreview = useObjectUrl(backFile);

  function runOcr() {
    if (!frontFile) { setError('Take a photo of the front of your ID first'); return; }
    setError(null);
    setProgress(0);
    setStep('extracting');
    start(async () => {
      let read = 0;
      let ranOcr = false;
      try {
        // Two photos share the bar: the front is the first half, the back
        // the second, so it advances once rather than resetting halfway.
        const halves = backFile ? 2 : 1;
        const frontText = await extractText(frontFile, (p) => setProgress(p / halves));
        const backText = backFile
          ? await extractText(backFile, (p) => setProgress(0.5 + p / 2))
          : '';
        ranOcr = true;
        const parsed = mergeParsed(parseKenyanIdText(frontText), parseKenyanIdText(backText));
        const filled = new Set<string>(filledNationalIdFields(parsed));
        const usable = SCANNED_FIELDS.filter((f) => filled.has(f));
        setDetails((d) => applyParsed(d, parsed));
        setScanned(new Set(usable));
        read = usable.length;
      } catch {
        // OCR failing is never fatal — the form still works, just blank.
        // The review step says which of the two happened rather than
        // leaving someone to wonder why it is empty.
      } finally {
        setScanReport({ read, ranOcr });
        setProgress(1);
        setStep('details');
      }
    });
  }

  function skipToDetails() {
    setError(null);
    setScanReport(null);
    setStep('details');
  }

  function submitDetails() {
    setError(null);
    setUploadWarning(null);
    start(async () => {
      const res = await actionStartJoin(registrationId, details);
      if (!res.ok) { setError(res.error); return; }
      setRegistrationId(res.data.registrationId);

      // The photos go up now, attached to the registration, and are kept
      // as the scan of record (see saveNationalIdRecord's front/back
      // document ids). A failed upload must not cost someone their
      // signup — it is reported and the flow continues, because the ID
      // photos can be added later from settings but a half-finished
      // registration cannot be resumed.
      const failed: string[] = [];
      if (frontFile) {
        const id = await upload(res.data.registrationId, 'front', frontFile);
        if (id) setFrontDocumentId(id); else failed.push('front');
      }
      if (backFile) {
        const id = await upload(res.data.registrationId, 'back', backFile);
        if (id) setBackDocumentId(id); else failed.push('back');
      }
      if (failed.length) {
        setUploadWarning(
          `We couldn't store the ${failed.join(' or ')} photo of your ID. Everything else is saved — you can add the photo later from your settings.`,
        );
      }

      const sent = await actionSendJoinOtp(details.msisdn);
      if (!sent.ok) { setError(sent.error); return; }
      setStep('otp');
    });
  }

  function verify() {
    if (!registrationId) return;
    setError(null);
    start(async () => {
      const res = await actionVerifyJoinOtp(registrationId, details.msisdn, code);
      if (!res.ok) { setError(res.error); return; }

      const done = await actionCompleteJoin(registrationId, {
        idNumber: details.idNumber || undefined,
        serialNumber: details.serialNumber || undefined,
        sex: details.sex || undefined,
        districtOfBirth: details.districtOfBirth || undefined,
        dateOfIssue: details.dateOfIssue || undefined,
        frontDocumentId, backDocumentId,
        inviteToken: invite?.token,
      });
      if (!done.ok) { setError(done.error); return; }

      // No candidates back (already-issued edge case) skips straight to
      // 'done' with nothing to pick — otherwise the person chooses.
      if (done.data.candidates.length === 0) { setStep('done'); return; }
      setHandleCandidates(done.data.candidates);
      setStep('pick-handle');
    });
  }

  function pickHandle(handle: string) {
    if (!registrationId) return;
    setError(null);
    setChosenHandle(handle);
    start(async () => {
      const res = await actionConfirmHandle(registrationId, handle);
      if (!res.ok) {
        setError(res.error);
        setChosenHandle(null);
        return;
      }
      setEsoqoId(res.data.esoqoId);
      setStep('done');
    });
  }

  if (step === 'capture' || step === 'extracting') {
    const busy = step === 'extracting';
    return (
      <div>
        <Steps step={step} />
        {invite && <InviteBanner invite={invite} />}

        <p className="sub" style={{ marginBottom: 14 }}>
          Scan the front and back of your national ID and we&apos;ll read what we can off it.
          The photos stay on this device until you&apos;ve checked the details on the next screen.
        </p>

        <div className="grid2" style={{ gap: 14, marginBottom: 14 }}>
          <IdCardScanner
            label="Front of your ID" disabled={busy}
            hint="Names, date of birth and ID number are on this side"
            file={frontFile} previewUrl={frontPreview}
            onCapture={setFrontFile} onClear={() => setFrontFile(null)}
          />
          <IdCardScanner
            label="Back of your ID" optional disabled={busy}
            hint="Serial number and date of issue live here"
            file={backFile} previewUrl={backPreview}
            onCapture={setBackFile} onClear={() => setBackFile(null)}
          />
        </div>

        <div className="note n-blue" style={{ marginBottom: 16 }}>
          <Icon name="lock" size={18} />
          <div>
            <strong>Your photos are kept</strong>
            <p style={{ fontSize: '.86rem' }}>
              Both sides are stored with your Esoqo record as your scanned ID, and the ID number
              itself is encrypted. They are held to confirm who you are &mdash; no other member,
              group or shop is ever shown them.
            </p>
          </div>
        </div>

        {error && <div className="note n-red" style={{ marginBottom: 16 }}><div><p>{error}</p></div></div>}

        {busy ? (
          <div className="joinocr">
            <p className="joinocr-lab">
              <Icon name="loader" size={15} className="spin" /> Reading your ID…
            </p>
            <div className="joinocr-bar" role="progressbar" aria-label="Reading your ID"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <span style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} />
            </div>
            <p className="hint" style={{ margin: 0 }}>
              This happens on your phone, not on our servers, so it can take a few seconds.
            </p>
          </div>
        ) : (
          <>
            <button type="button" className="btn btn-p" style={{ width: '100%' }}
              disabled={!frontFile} onClick={runOcr}>
              Read my ID <Icon name="arrow-right" size={16} />
            </button>
            <button type="button" className="btn btn-o" style={{ width: '100%', marginTop: 8 }}
              onClick={skipToDetails}>
              Skip — I&apos;ll type it in myself
            </button>
          </>
        )}
      </div>
    );
  }

  if (step === 'details') {
    return (
      <>
        <Steps step={step} />
        <DetailsForm
          details={details} onChange={setDetails} error={error}
          pending={pending} onSubmit={submitDetails}
          scanned={scanned} scanReport={scanReport}
          frontPreview={frontPreview} backPreview={backPreview}
          onRescan={() => { setError(null); setStep('capture'); }}
          invite={invite}
        />
      </>
    );
  }

  if (step === 'otp') {
    return (
      <div>
        <Steps step={step} />
        <p className="sub" style={{ marginBottom: 14 }}>
          Last step. We sent a six-digit code to{' '}
          <strong className="mono">{details.msisdn}</strong>{' '}&mdash;{' '}
          <button type="button" className="linkish" onClick={() => { setError(null); setStep('details'); }}>
            not your number?
          </button>
        </p>
        {uploadWarning && (
          <div className="note n-amber" style={{ marginBottom: 14 }}>
            <Icon name="alert-triangle" size={18} />
            <div><p>{uploadWarning}</p></div>
          </div>
        )}
        <div className="fld">
          <label className="lab" htmlFor="join-code"><Icon name="keypad" size={15} />Code</label>
          <input className="inp mono joincode" id="join-code" value={code} onChange={(e) => setCode(e.target.value)}
            inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
          <p className="hint">It can take a minute to arrive.</p>
        </div>
        {error && <div className="note n-red" style={{ marginBottom: 16 }} role="alert"><div><p>{error}</p></div></div>}
        <button type="button" className="btn btn-p" style={{ width: '100%' }}
          disabled={pending || code.trim().length !== 6} onClick={verify}>
          {pending ? 'Confirming…' : 'Confirm & join'} <Icon name="check" size={16} />
        </button>
      </div>
    );
  }

  if (step === 'pick-handle') {
    return (
      <div>
        <Steps step={step} />
        <h2 style={{ marginTop: 12 }}>Pick your esoqo ID</h2>
        <p className="sub" style={{ marginBottom: 14 }}>
          This is the handle people use to pay or find you. Choose one — it can&apos;t be changed later.
        </p>
        <div role="radiogroup" aria-label="Candidate esoqo IDs">
          {handleCandidates.map((handle) => (
            <button
              key={handle}
              type="button"
              role="radio"
              aria-checked={chosenHandle === handle}
              disabled={pending}
              onClick={() => pickHandle(handle)}
              className="btn"
              style={{
                width: '100%', textAlign: 'left', marginBottom: 10,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{handle}</span>
              {chosenHandle === handle && pending
                ? <Icon name="loader" size={16} />
                : <Icon name="arrow-right" size={16} />}
            </button>
          ))}
        </div>
        {error && <div className="note n-red" style={{ marginTop: 8 }} role="alert"><div><p>{error}</p></div></div>}
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <Icon name="check-circle" size={40} />
      <h2 style={{ marginTop: 12 }}>Welcome to Esoqo</h2>
      <p className="lead" style={{ marginTop: 6 }}>Your esoqo ID is</p>
      <p className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, margin: '8px 0 18px' }}>{esoqoId}</p>
      {invite && (
        <p className="sub" style={{ margin: '0 0 18px' }}>
          {invite.joinFeeKes > 0
            ? `Your place in ${invite.orgName} is held. Set a PIN, then pay the KES ${invite.joinFeeKes.toLocaleString('en-KE')} join fee to activate it.`
            : `You are a member of ${invite.orgName} — it will be waiting once you set a PIN.`}
        </p>
      )}
      <a className="btn btn-p" style={{ width: '100%' }} href="/signin/set-pin">
        Continue — set your PIN <Icon name="arrow-right" size={16} />
      </a>
    </div>
  );
}

/**
 * Where you are and how much is left.
 *
 * Three steps and a finish. Worth the space precisely because the middle
 * step is long: someone looking at a thirteen-field form with no idea
 * whether two more like it are coming will reasonably decide to do this
 * later, and "later" is how a signup is abandoned. Naming the steps also
 * sets the expectation that the ID scan is *not* the whole thing — the
 * code on their phone is, and that arrives at the end.
 */
const WIZARD_STEPS: Array<{ key: Step; label: string }> = [
  { key: 'capture', label: 'Scan' },
  { key: 'details', label: 'Check' },
  { key: 'otp', label: 'Confirm' },
];

function Steps({ step }: { step: Step }) {
  // 'extracting' is a state of the capture step, not a step of its own —
  // a progress bar that advanced while OCR ran would promise a stage that
  // does not exist.
  const current = step === 'extracting' ? 'capture' : step;
  const index = WIZARD_STEPS.findIndex((s) => s.key === current);
  const position = current === 'done' || current === 'pick-handle' ? WIZARD_STEPS.length : index;

  return (
    <ol className="jsteps" aria-label={`Step ${position + 1} of ${WIZARD_STEPS.length}`}>
      {WIZARD_STEPS.map((s, i) => {
        const state = i < position ? 'done' : i === position ? 'on' : 'todo';
        return (
          <li key={s.key} className={state}>
            <span className="bar" />
            <span className="jsteps-lab">
              {state === 'done' && <Icon name="check" size={11} />}
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function InviteBanner({ invite }: { invite: JoinInvite }) {
  return (
    <div className="note n-green" style={{ marginBottom: 16 }}>
      <Icon name="users" size={18} />
      <div>
        <strong>{invite.inviterName ?? 'An officer'} added you to {invite.orgName}</strong>
        <p>
          We already have your name and number from them, so they&apos;re filled in below.
          {invite.joinFeeKes > 0 && (
            <>{' '}The group asks for a one-time KES {invite.joinFeeKes.toLocaleString('en-KE')}{' '}
              join fee, which you can pay once you&apos;re in.</>
          )}
        </p>
      </div>
    </div>
  );
}

/** An invite already knows who this is — starting them on a blank form
 *  asks for what the officer typed in an hour ago. The phone number
 *  matters most: it is what ties this signup back to the membership
 *  waiting for them (completeRegistration matches an existing Person on
 *  msisdn), which is why DetailsForm warns if it gets changed. */
function initialDetails(invite: JoinInvite | null): JoinDetails {
  if (!invite) return EMPTY_DETAILS;
  return {
    ...EMPTY_DETAILS,
    firstName: invite.firstName ?? '',
    middleName: invite.middleName ?? '',
    surname: invite.surname ?? '',
    msisdn: invite.msisdn ?? EMPTY_DETAILS.msisdn,
    email: invite.email ?? '',
  };
}

/** Pours a scan into the form, leaving any field the card had nothing for
 *  exactly as it was — so a re-scan of a better-lit photo tops up what was
 *  missing instead of blanking what the first pass got right. */
function applyParsed(d: JoinDetails, parsed: ParsedNationalId): JoinDetails {
  return {
    ...d,
    firstName: parsed.firstName ?? d.firstName,
    middleName: parsed.middleName ?? d.middleName,
    surname: parsed.surname ?? d.surname,
    dateOfBirth: parsed.dateOfBirth ?? d.dateOfBirth,
    sex: parsed.sex ?? d.sex,
    county: parsed.county ?? d.county,
    districtOfBirth: parsed.districtOfBirth ?? d.districtOfBirth,
    idNumber: parsed.idNumber ?? d.idNumber,
    serialNumber: parsed.serialNumber ?? d.serialNumber,
    dateOfIssue: parsed.dateOfIssue ?? d.dateOfIssue,
  };
}

async function upload(registrationId: string, side: 'front' | 'back', file: File): Promise<string | null> {
  try {
    const fd = new FormData();
    fd.set('registrationId', registrationId);
    fd.set('side', side);
    fd.set('file', file);
    const up = await actionUploadJoinDocument(fd);
    return up.ok ? up.docId : null;
  } catch {
    return null;
  }
}

/** One object URL per File, revoked when the File changes or on unmount. */
function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setUrl(null); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}
