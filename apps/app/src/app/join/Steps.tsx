'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Icon, type IconName } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import {
  actionUpload, actionListDocuments, actionRemoveDocument,
  actionDeclarePayment, actionDeferPayment,
} from './upload';
import { actionInitiateStkPush, actionCheckPaymentStatus } from './payment';

/* ═══════════════════════════ documents ═══════════════════════════ */

const KINDS: [string, string][] = [
  ['NATIONAL_ID', 'National ID'],
  ['PASSPORT', 'Passport photo'],
  ['GROUP_CONSTITUTION', 'Group constitution or rules'],
  ['MEMBER_LIST', 'Member list'],
  ['MINUTES', 'Meeting minutes'],
  ['REGISTRATION_CERT', 'Registration certificate'],
  ['BUSINESS_CERT', 'Business registration certificate'],
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
              {human(file.size)} · only staff reviewing your CECF registration will see this.
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
  registrationId, choice, feeCoveredByGroup, onChoice, defaultMsisdn,
}: {
  registrationId: string;
  choice: 'paid' | 'stk' | 'later' | '';
  feeCoveredByGroup?: boolean;
  onChoice: (c: 'paid' | 'stk' | 'later', declared: boolean) => void;
  /** Pre-fills the STK phone field with the number already on the
   *  registration — most people pay from the same line they registered. */
  defaultMsisdn?: string;
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

  const [stkMsisdn, setStkMsisdn] = useState(defaultMsisdn ?? '');
  const [stkAmount, setStkAmount] = useState('');
  const [stkStatus, setStkStatus] = useState<'idle' | 'sending' | 'waiting' | 'confirmed' | 'failed' | 'timeout'>('idle');
  const [stkError, setStkError] = useState<string | null>(null);

  useEffect(() => {
    if (!feeCoveredByGroup || covered) return;
    start(async () => {
      await actionDeferPayment(registrationId);
      setCovered(true);
      onChoice('later', true);
      announce('Noted — your group covers this fee.', 'assertive');
    });
    // Runs once when this step is reached with the fee already covered.
    // onChoice/announce/registrationId are deliberately excluded: onChoice
    // is an inline callback recreated every parent render, and including it
    // would refire this effect (and re-post actionDeferPayment) on every
    // render that happens before `covered` flips true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeCoveredByGroup]);

  // While waiting on a real Daraja callback (sandbox/production — console
  // mode never reaches this state, since sendStkPush already resolves
  // CONFIRMED synchronously), poll every 4s until the callback lands.
  // Declared above the feeCoveredByGroup early return below — hooks must
  // run in the same order on every render, group-covered or not.
  useEffect(() => {
    if (stkStatus !== 'waiting') return;
    const id = setInterval(async () => {
      const r = await actionCheckPaymentStatus(registrationId);
      if (r.status === 'CONFIRMED') {
        setStkStatus('confirmed'); onChoice('stk', true);
        announce('Payment received — thank you.', 'assertive');
      }
    }, 4000);
    return () => clearInterval(id);
    // onChoice/announce excluded — same reasoning as the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stkStatus, registrationId]);

  // Safaricom never calls the webhook back for a prompt that just sat
  // there unanswered, so without this the screen would say "check your
  // phone" forever. 30s is short enough that someone who genuinely missed
  // the prompt isn't left staring at a stale screen, at the cost of it
  // firing before a real ~60s-lifetime prompt has technically expired on
  // the phone — that's fine, "resend" is one tap away either way. Cleared
  // automatically the moment stkStatus leaves 'waiting' (confirmed by the
  // poll above, or a manual resend), so a late confirmation is never
  // overwritten.
  useEffect(() => {
    if (stkStatus !== 'waiting') return;
    const t = setTimeout(() => {
      setStkStatus('timeout');
      announce("We have not heard back yet. The prompt may have expired or been missed — you can send it again.", 'assertive');
    }, 30_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stkStatus]);

  if (feeCoveredByGroup) {
    return (
      <>
        <h2 className="qh">Your group covers this fee</h2>
        <p className="qs">
          Nothing more to do here. We check the group&rsquo;s account for your registration
          and let you know either way.
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
        announce('Payment details saved. We will check them against the receipt.', 'assertive');
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

  function sendStkPush() {
    setStkError(null);
    setStkStatus('sending');
    start(async () => {
      const r = await actionInitiateStkPush({
        registrationId, msisdn: stkMsisdn, amountKes: stkAmount ? Number(stkAmount) : undefined,
      });
      if (!r.ok) {
        setStkStatus('failed'); setStkError(r.error); announce(r.error, 'assertive');
        return;
      }
      if (r.status === 'CONFIRMED') {
        setStkStatus('confirmed'); onChoice('stk', true);
        announce('Payment received — thank you.', 'assertive');
      } else {
        setStkStatus('waiting');
        announce('Check your phone and enter your M-Pesa PIN.', 'assertive');
      }
    });
  }

  return (
    <>
      <h2 className="qh">Have you paid the registration fee?</h2>
      <p className="qs">
        Either answer is fine. Saying you have paid does not confirm it — staff check the
        receipt against the account, and two of them have to agree before it is marked as
        received.
      </p>

      <div className="opts">
        <button type="button" className="opt" aria-pressed={choice === 'stk'}
          onClick={() => onChoice('stk', false)}>
          <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
            <Icon name="phone-call" size={18} />
          </span>
          <span>
            <span className="t">Pay now with M-Pesa</span>
            <span className="d">We send a prompt to your phone — enter your PIN there</span>
          </span>
        </button>
        <button type="button" className="opt" aria-pressed={choice === 'paid'}
          onClick={() => onChoice('paid', false)}>
          <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
            <Icon name="check-circle" size={18} />
          </span>
          <span>
            <span className="t">I already paid</span>
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

      {choice === 'stk' && stkStatus !== 'confirmed' && (
        <div className="sub2">
          <div className="fld">
            <label className="lab" htmlFor="stk-msisdn">Phone number to prompt</label>
            <input className="inp mono" id="stk-msisdn" value={stkMsisdn} inputMode="tel"
              onChange={(e) => setStkMsisdn(e.target.value)} placeholder="+254 7…"
              disabled={stkStatus === 'sending' || stkStatus === 'waiting'} />
          </div>
          <div className="fld">
            <label className="lab" htmlFor="stk-amount">Amount to pay (KES)</label>
            <input className="inp mono" id="stk-amount" inputMode="numeric" value={stkAmount}
              onChange={(e) => setStkAmount(e.target.value.replace(/\D/g, ''))} placeholder="200"
              disabled={stkStatus === 'sending' || stkStatus === 'waiting'} />
            <p className="hint">Pay whatever amount applies to you — we do not fix one figure for everyone.</p>
          </div>

          {stkStatus === 'idle' || stkStatus === 'failed' ? (
            <button type="button" className="btn btn-p" onClick={sendStkPush}
              disabled={pending || !stkMsisdn.trim() || !stkAmount.trim()}>
              <Icon name="send" size={16} />{stkStatus === 'failed' ? 'Try again' : 'Send the prompt'}
            </button>
          ) : stkStatus === 'timeout' ? (
            <div className="paidbox" style={{ borderColor: 'var(--amber)' }}>
              <span className="icbox" style={{ background: 'var(--amber-t)', color: 'var(--amber)' }}>
                <Icon name="alert-triangle" size={19} />
              </span>
              <div style={{ flex: 1 }}>
                <strong style={{ display: 'block', marginBottom: 3 }}>Still waiting on that one</strong>
                <span className="hint" style={{ margin: '0 0 10px', display: 'block' }}>
                  We have not heard back — the prompt on {stkMsisdn} may have expired or been missed.
                  Nothing was charged. Check the number and amount above, then send another.
                </span>
                <button type="button" className="btn btn-o btn-sm" onClick={sendStkPush}
                  disabled={pending || !stkMsisdn.trim() || !stkAmount.trim()}>
                  <Icon name="refresh" size={14} />Resend prompt
                </button>
              </div>
            </div>
          ) : (
            <div className="paidbox">
              <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
                <Icon name="clock" size={19} />
              </span>
              <div style={{ flex: 1 }}>
                <strong style={{ display: 'block', marginBottom: 3 }}>Check your phone</strong>
                <span className="hint" style={{ margin: 0 }}>
                  A prompt was sent to {stkMsisdn}. Enter your M-Pesa PIN there — this updates on
                  its own once it's confirmed, no need to reload.
                </span>
                {stkStatus === 'waiting' && (
                  <button type="button" className="btn btn-o btn-sm" style={{ marginTop: 10 }}
                    onClick={sendStkPush} disabled={pending}>
                    <Icon name="refresh" size={14} />Didn&rsquo;t get it? Resend
                  </button>
                )}
              </div>
            </div>
          )}

          {stkError && (
            <p className="err" role="alert" style={{ marginTop: 12 }}>
              <Icon name="alert-circle" size={15} />{stkError}
            </p>
          )}
        </div>
      )}

      {choice === 'stk' && stkStatus === 'confirmed' && (
        <div className="paidbox">
          <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
            <Icon name="check-circle" size={19} />
          </span>
          <div>
            <strong style={{ display: 'block', marginBottom: 3 }}>Payment received</strong>
            <span className="hint" style={{ margin: 0 }}>
              Confirmed automatically by M-Pesa — no manual check needed. You will get an SMS too.
            </span>
          </div>
        </div>
      )}

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
              Reference <span className="mono">{reference}</span>. We check this against the
              account and two people must agree before it is marked as received. You will get an
              SMS either way.
            </span>
          </div>
        </div>
      )}
    </>
  );
}
