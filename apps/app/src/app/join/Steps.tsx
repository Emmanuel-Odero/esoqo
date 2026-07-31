'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Icon, type IconName } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import {
  actionUpload, actionListDocuments, actionRemoveDocument,
  actionDeclarePayment, actionDeferPayment,
} from './upload';

/* ═══════════════════════════ documents ═══════════════════════════ */

const KINDS: [string, string][] = [
  ['NATIONAL_ID', 'National ID'],
  ['GROUP_CONSTITUTION', 'Group constitution or rules'],
  ['MEMBER_LIST', 'Member list'],
  ['MINUTES', 'Meeting minutes'],
  ['REGISTRATION_CERT', 'Registration certificate'],
  ['KRA_PIN', 'KRA PIN certificate'],
  ['PERMIT', 'County permit or licence'],
  ['PAYMENT_RECEIPT', 'Payment receipt'],
  ['PHOTO', 'Photograph'],
  ['OTHER', 'Something else'],
];

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg';

interface Doc { id: string; title: string; kind: string; mimeType: string; sizeBytes: number }

function human(b: number) {
  return b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}
function fileIcon(mime: string): IconName {
  if (mime.startsWith('image/')) return 'certificate';
  if (mime.includes('sheet') || mime.includes('excel')) return 'grid';
  return 'document';
}

export function DocumentStep({ registrationId }: { registrationId: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('NATIONAL_ID');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const announce = useAnnounce();

  useEffect(() => {
    void actionListDocuments(registrationId).then(setDocs);
  }, [registrationId]);

  // Local object URL so the person sees the file before it is sent.
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(f: File | null) {
    setError(null);
    if (!f) { setFile(null); return; }
    if (f.size > 10 * 1024 * 1024) {
      setError('That file is larger than 10 MB');
      announce('That file is larger than 10 MB', 'assertive');
      return;
    }
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').slice(0, 60));
  }

  function upload() {
    if (!file || !title.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set('registrationId', registrationId);
    fd.set('title', title.trim());
    fd.set('kind', kind);
    fd.set('file', file);

    start(async () => {
      const r = await actionUpload(fd);
      if (r.ok) {
        setDocs((p) => [r.doc, ...p]);
        setFile(null); setTitle(''); setPreviewUrl(null);
        if (inputRef.current) inputRef.current.value = '';
        announce(`${r.doc.title} saved`, 'assertive');
      } else {
        setError(r.error);
        announce(r.error, 'assertive');
      }
    });
  }

  function remove(d: Doc) {
    start(async () => {
      const r = await actionRemoveDocument(d.id);
      if (r.ok) {
        setDocs((p) => p.filter((x) => x.id !== d.id));
        announce(`${d.title} removed`, 'assertive');
      } else setError(r.error ?? 'Could not remove that');
    });
  }

  return (
    <>
      <h2 className="qh">Any papers you already have</h2>
      <p className="qs">
        Entirely optional. If you have a national ID, a registration certificate or your group’s
        rules to hand, adding them now saves a trip later. You can add them any time instead.
      </p>

      <div className="upzone">
        <input ref={inputRef} type="file" id="doc-file" accept={ACCEPT}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
        <label htmlFor="doc-file" className="upbtn">
          <Icon name="download" size={20} style={{ transform: 'rotate(180deg)' }} />
          <span>
            <strong>{file ? file.name : 'Choose a file'}</strong>
            <span className="hint" style={{ margin: 0 }}>
              PDF, Word, Excel, PNG or JPG · up to 10 MB
            </span>
          </span>
        </label>
      </div>

      {file && (
        <div className="uppreview">
          <div className="upthumb">
            {previewUrl
              ? <img src={previewUrl} alt={`Preview of ${file.name}`} />
              : <Icon name={fileIcon(file.type)} size={28} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="fld" style={{ marginBottom: 10 }}>
              <label className="lab" htmlFor="doc-title">What is this?</label>
              <input className="inp" id="doc-title" value={title} maxLength={60}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. My ID, front and back" />
            </div>
            <div className="fld" style={{ marginBottom: 10 }}>
              <label className="lab" htmlFor="doc-kind">Kind of document</label>
              <select className="inp" id="doc-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="btn btn-p" onClick={upload}
                disabled={pending || !title.trim()}>
                <Icon name="check" size={16} />Save this file
              </button>
              <button type="button" className="btn btn-o"
                onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = ''; }}>
                Cancel
              </button>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              {human(file.size)} · only Esoko staff reviewing your registration will see this.
            </p>
          </div>
        </div>
      )}

      {error && (
        <p className="err" role="alert" style={{ marginTop: 12 }}>
          <Icon name="alert-circle" size={15} />{error}
        </p>
      )}

      {docs.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <p className="lab">Saved ({docs.length})</p>
          {docs.map((d) => (
            <div className="docrow" key={d.id}>
              <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
                <Icon name={fileIcon(d.mimeType)} size={17} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: '.92rem', display: 'block' }}>{d.title}</strong>
                <span className="hint" style={{ margin: 0 }}>
                  {KINDS.find(([k]) => k === d.kind)?.[1]} · {human(d.sizeBytes)}
                </span>
              </div>
              <button type="button" className="btn btn-o"
                style={{ minHeight: 38, padding: '7px 13px', fontSize: '.84rem' }}
                onClick={() => remove(d)} disabled={pending}
                aria-label={`Remove ${d.title}`}>
                <Icon name="close" size={14} />Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════ payment ═══════════════════════════ */

export function PaymentStep({
  registrationId, choice, feeCoveredByGroup, onChoice,
}: {
  registrationId: string;
  choice: 'paid' | 'later' | '';
  feeCoveredByGroup?: boolean;
  onChoice: (c: 'paid' | 'later', declared: boolean) => void;
}) {
  const [method, setMethod] = useState<'MPESA' | 'BANK_TRANSFER' | 'CASH_TO_AGENT'>('MPESA');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [covered, setCovered] = useState(false);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  useEffect(() => {
    if (!feeCoveredByGroup || covered) return;
    start(async () => {
      await actionDeferPayment(registrationId);
      setCovered(true);
      onChoice('later', true);
      announce('Noted — your group covers this fee.', 'assertive');
    });
    // Runs once when this step is reached with the fee already covered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeCoveredByGroup]);

  if (feeCoveredByGroup) {
    return (
      <>
        <h2 className="qh">Your group covers this fee</h2>
        <p className="qs">
          Nothing more to do here. Esoko checks the group&rsquo;s account for your registration
          and lets you know either way.
        </p>
        <div className="paidbox">
          <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
            <Icon name="check-circle" size={19} />
          </span>
          <div>
            <strong style={{ display: 'block', marginBottom: 3 }}>Covered by your group</strong>
            <span className="hint" style={{ margin: 0 }}>
              You said this earlier — change it from the previous step if that is wrong.
            </span>
          </div>
        </div>
      </>
    );
  }

  function declare() {
    setError(null);
    start(async () => {
      const r = await actionDeclarePayment(registrationId, {
        method, reference,
        amountKes: amount ? Number(amount) : undefined,
        note: note || undefined,
      });
      if (r.ok) {
        setSaved(true);
        onChoice('paid', true);
        announce('Payment details saved. Esoko will check them against the receipt.', 'assertive');
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  function defer() {
    start(async () => {
      await actionDeferPayment(registrationId);
      onChoice('later', true);
      announce('Noted — you can pay later.', 'assertive');
    });
  }

  return (
    <>
      <h2 className="qh">Have you paid the registration fee?</h2>
      <p className="qs">
        Either answer is fine. Saying you have paid does not confirm it — Esoko staff check the
        receipt against the account, and two of them have to agree before it is marked as
        received.
      </p>

      <div className="opts">
        <button type="button" className="opt" aria-pressed={choice === 'paid'}
          onClick={() => onChoice('paid', false)}>
          <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
            <Icon name="check-circle" size={18} />
          </span>
          <span>
            <span className="t">Yes, I have paid</span>
            <span className="d">You will enter the transaction code from your message</span>
          </span>
        </button>
        <button type="button" className="opt" aria-pressed={choice === 'later'}
          onClick={defer} disabled={pending}>
          <span className="icbox"><Icon name="clock" size={18} /></span>
          <span>
            <span className="t">Not yet — I will pay later</span>
            <span className="d">Your record is created either way. Nothing is blocked</span>
          </span>
        </button>
      </div>

      {choice === 'paid' && !saved && (
        <div className="sub2">
          <div className="fld">
            <label className="lab" htmlFor="pay-method">How did you pay?</label>
            <select className="inp" id="pay-method" value={method}
              onChange={(e) => setMethod(e.target.value as 'MPESA')}>
              <option value="MPESA">M-Pesa</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="CASH_TO_AGENT">Cash to an Esoko officer</option>
            </select>
          </div>

          <div className="fld">
            <label className="lab" htmlFor="pay-ref">
              {method === 'MPESA' ? 'M-Pesa transaction code' :
               method === 'BANK_TRANSFER' ? 'Bank reference' : 'Receipt number'}
            </label>
            <input className="inp mono" id="pay-ref" value={reference}
              onChange={(e) => setReference(e.target.value.toUpperCase())}
              placeholder={method === 'MPESA' ? 'SFH4K2L9QW' : 'Reference number'}
              autoComplete="off" maxLength={20} />
            <p className="hint">
              {method === 'MPESA'
                ? 'The code at the start of the M-Pesa message, like SFH4K2L9QW.'
                : 'Whatever reference appears on your receipt.'}
            </p>
          </div>

          <div className="fld">
            <label className="lab" htmlFor="pay-amt">
              Amount paid <span className="op">— optional</span>
            </label>
            <input className="inp mono" id="pay-amt" inputMode="numeric" value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="1000" />
          </div>

          <div className="fld">
            <label className="lab" htmlFor="pay-note">
              Anything we should know <span className="op">— optional</span>
            </label>
            <input className="inp" id="pay-note" value={note} maxLength={140}
              onChange={(e) => setNote(e.target.value)}
              placeholder="My daughter sent it from her number" />
          </div>

          <button type="button" className="btn btn-p" onClick={declare}
            disabled={pending || !reference.trim()}>
            <Icon name="check" size={16} />Save these details
          </button>

          {error && (
            <p className="err" role="alert" style={{ marginTop: 12 }}>
              <Icon name="alert-circle" size={15} />{error}
            </p>
          )}
        </div>
      )}

      {saved && (
        <div className="paidbox">
          <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
            <Icon name="check-circle" size={19} />
          </span>
          <div>
            <strong style={{ display: 'block', marginBottom: 3 }}>Details saved</strong>
            <span className="hint" style={{ margin: 0 }}>
              Reference <span className="mono">{reference}</span>. Esoko checks this against the
              account and two people must agree before it is marked as received. You will get an
              SMS either way.
            </span>
          </div>
        </div>
      )}
    </>
  );
}
