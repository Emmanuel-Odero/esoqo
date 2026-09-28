'use client';

import { useRef, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { parseKenyanIdText, type ParsedNationalId } from '@esoqo/domain';
import {
  actionStartJoin, actionUploadJoinDocument, actionSendJoinOtp, actionVerifyJoinOtp,
  actionCompleteJoin, type JoinDetails,
} from './actions';
import { DetailsForm } from './DetailsForm';

type Step = 'capture' | 'extracting' | 'details' | 'otp' | 'done';

const EMPTY_DETAILS: JoinDetails = {
  firstName: '', middleName: '', surname: '', dateOfBirth: '', sex: '',
  county: '', ward: '', msisdn: '+254 7', email: '',
  idNumber: '', serialNumber: '', districtOfBirth: '', dateOfIssue: '',
};

/**
 * Runs tesseract.js against a photo, client-side — no image or extracted
 * text ever leaves the browser during this step. Best-effort only: see
 * parseKenyanIdText's own doc comment for why every field this produces
 * lands in an editable input, never written straight through.
 */
async function extractText(file: File): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
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

export function JoinWizard() {
  const [step, setStep] = useState<Step>('capture');
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [details, setDetails] = useState<JoinDetails>(EMPTY_DETAILS);
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [frontDocumentId, setFrontDocumentId] = useState<string | undefined>(undefined);
  const [backDocumentId, setBackDocumentId] = useState<string | undefined>(undefined);
  const [code, setCode] = useState('');
  const [esoqoId, setEsoqoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);

  function pickFile(side: 'front' | 'back', file: File | undefined) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (side === 'front') { setFrontFile(file); setFrontPreview(url); }
    else { setBackFile(file); setBackPreview(url); }
  }

  function runOcr() {
    if (!frontFile) { setError('Take a photo of the front of your ID first'); return; }
    setError(null);
    setStep('extracting');
    start(async () => {
      try {
        const frontText = await extractText(frontFile);
        const backText = backFile ? await extractText(backFile) : '';
        const parsed = mergeParsed(parseKenyanIdText(frontText), parseKenyanIdText(backText));
        setDetails((d) => ({
          ...d,
          firstName: parsed.firstName ?? d.firstName,
          middleName: parsed.middleName ?? d.middleName,
          surname: parsed.surname ?? d.surname,
          dateOfBirth: parsed.dateOfBirth ?? d.dateOfBirth,
          sex: parsed.sex ?? d.sex,
          districtOfBirth: parsed.districtOfBirth ?? d.districtOfBirth,
          idNumber: parsed.idNumber ?? d.idNumber,
          serialNumber: parsed.serialNumber ?? d.serialNumber,
          dateOfIssue: parsed.dateOfIssue ?? d.dateOfIssue,
        }));
      } catch {
        // OCR failing is never fatal — the form still works, just blank.
      } finally {
        setStep('details');
      }
    });
  }

  function skipToDetails() {
    setError(null);
    setStep('details');
  }

  function submitDetails() {
    setError(null);
    start(async () => {
      const res = await actionStartJoin(registrationId, details);
      if (!res.ok) { setError(res.error); return; }
      setRegistrationId(res.data.registrationId);

      if (frontFile) {
        const fd = new FormData();
        fd.set('registrationId', res.data.registrationId);
        fd.set('side', 'front');
        fd.set('file', frontFile);
        const up = await actionUploadJoinDocument(fd);
        if (up.ok) setFrontDocumentId(up.docId);
      }
      if (backFile) {
        const fd = new FormData();
        fd.set('registrationId', res.data.registrationId);
        fd.set('side', 'back');
        fd.set('file', backFile);
        const up = await actionUploadJoinDocument(fd);
        if (up.ok) setBackDocumentId(up.docId);
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
      });
      if (!done.ok) { setError(done.error); return; }
      setEsoqoId(done.data.esoqoId);
      setStep('done');
    });
  }

  if (step === 'capture' || step === 'extracting') {
    return (
      <div>
        <p className="sub" style={{ marginBottom: 14 }}>
          Photograph the front and back of your national ID. This stays on your phone
          until you submit — nothing is sent until you confirm the details next.
        </p>

        <div className="grid2" style={{ gap: 14, marginBottom: 16 }}>
          <div>
            <label className="lab" style={{ display: 'block', marginBottom: 6 }}>Front of ID *</label>
            {frontPreview
              ? <img src={frontPreview} alt="Front of ID" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line)' }} />
              : <div style={{ border: '1px dashed var(--line)', borderRadius: 8, padding: 24, textAlign: 'center', color: 'var(--tx-2)' }}>No photo yet</div>}
            <input
              ref={frontInputRef} type="file" accept="image/*" capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => pickFile('front', e.target.files?.[0])}
            />
            <button type="button" className="btn btn-o btn-sm" style={{ width: '100%', marginTop: 8 }}
              onClick={() => frontInputRef.current?.click()}>
              <Icon name="qr" size={14} /> {frontFile ? 'Retake' : 'Take photo'}
            </button>
          </div>
          <div>
            <label className="lab" style={{ display: 'block', marginBottom: 6 }}>Back of ID</label>
            {backPreview
              ? <img src={backPreview} alt="Back of ID" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line)' }} />
              : <div style={{ border: '1px dashed var(--line)', borderRadius: 8, padding: 24, textAlign: 'center', color: 'var(--tx-2)' }}>No photo yet</div>}
            <input
              ref={backInputRef} type="file" accept="image/*" capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => pickFile('back', e.target.files?.[0])}
            />
            <button type="button" className="btn btn-o btn-sm" style={{ width: '100%', marginTop: 8 }}
              onClick={() => backInputRef.current?.click()}>
              <Icon name="qr" size={14} /> {backFile ? 'Retake' : 'Take photo'}
            </button>
          </div>
        </div>

        {error && <div className="note n-red" style={{ marginBottom: 16 }}><div><p>{error}</p></div></div>}

        <button type="button" className="btn btn-p" style={{ width: '100%' }}
          disabled={step === 'extracting' || !frontFile} onClick={runOcr}>
          {step === 'extracting' ? 'Reading your ID…' : 'Continue'} <Icon name="arrow-right" size={16} />
        </button>
        <button type="button" className="btn btn-o" style={{ width: '100%', marginTop: 8 }}
          disabled={step === 'extracting'} onClick={skipToDetails}>
          Skip — I&apos;ll type it in myself
        </button>
      </div>
    );
  }

  if (step === 'details') {
    return (
      <DetailsForm
        details={details} onChange={setDetails} error={error}
        pending={pending} onSubmit={submitDetails}
      />
    );
  }

  if (step === 'otp') {
    return (
      <div>
        <p className="sub" style={{ marginBottom: 14 }}>
          We sent a six-digit code to {details.msisdn}.
        </p>
        <div className="fld">
          <label className="lab" htmlFor="join-code"><Icon name="keypad" size={15} />Code</label>
          <input className="inp mono" id="join-code" value={code} onChange={(e) => setCode(e.target.value)}
            inputMode="numeric" maxLength={6} />
        </div>
        {error && <div className="note n-red" style={{ marginBottom: 16 }}><div><p>{error}</p></div></div>}
        <button type="button" className="btn btn-p" style={{ width: '100%' }}
          disabled={pending || code.trim().length !== 6} onClick={verify}>
          {pending ? 'Confirming…' : 'Confirm & join'} <Icon name="check" size={16} />
        </button>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <Icon name="check-circle" size={40} />
      <h2 style={{ marginTop: 12 }}>Welcome to Esoqo</h2>
      <p className="lead" style={{ marginTop: 6 }}>Your esoqo ID is</p>
      <p className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, margin: '8px 0 18px' }}>{esoqoId}</p>
      <a className="btn btn-p" style={{ width: '100%' }} href="/signin/set-pin">
        Continue — set your PIN <Icon name="arrow-right" size={16} />
      </a>
    </div>
  );
}
