'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, QrCode } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionApplyForOrgHandle, actionConfirmOrgHandle } from '../actions';

export interface HandleStatus {
  code: string | null;
  applicationStatus: 'NOT_APPLIED' | 'PENDING' | 'APPROVED' | 'ISSUED';
  candidates: string[];
}

/**
 * The officer-facing "claim your own esoqo ID" panel — a business, chama
 * or other org applying to use its own name (or a mnemonic of it) rather
 * than the random handle every org otherwise gets. Mirrors the personal
 * pick-handle step in apps/app/src/app/join/JoinWizard.tsx, but with an
 * application-and-review step in front of it (see
 * dal/handle-application.ts): unlike a person's phone number, an org's
 * name is exactly what ends up in the handle, so staff must confirm the
 * applicant is entitled to it first.
 */
export function HandlePanel({ orgId, status }: { orgId: string; status: HandleStatus }) {
  if (status.applicationStatus === 'ISSUED' && status.code) {
    return <IssuedCard code={status.code} />;
  }

  return (
    <section className="mcard" aria-label="Esoqo ID handle">
      <h2><Icon name="qr" size={18} />Esoqo ID handle</h2>
      {status.applicationStatus === 'NOT_APPLIED' && <ApplyForm orgId={orgId} />}
      {status.applicationStatus === 'PENDING' && (
        <p className="sub">
          Your legitimacy documents are with our team for review. Once approved, you&apos;ll be able
          to pick a handle here.
        </p>
      )}
      {status.applicationStatus === 'APPROVED' && (
        <PickHandle orgId={orgId} candidates={status.candidates} />
      )}
    </section>
  );
}

function IssuedCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const announce = useAnnounce();

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      announce('Esoqo ID copied.', 'polite');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      announce('Could not copy — select and copy the code by hand.', 'assertive');
    }
  }

  return (
    <section className="mcard mcard--premium" aria-label="Esoqo ID handle">
      <h2><Icon name="qr" size={18} />Esoqo ID</h2>
      <p className="mcard-lede">What anyone pays this organisation with.</p>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <QrCode value={code} size={128} />
        <div>
          <div className="mono" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--navy)' }}>{code}</div>
          <button type="button" className="btn btn-o btn-sm" style={{ marginTop: 10 }} onClick={copy}>
            <Icon name={copied ? 'check' : 'link'} size={15} />{copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </section>
  );
}

function ApplyForm({ orgId }: { orgId: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    const files = fileInput.current?.files;
    if (!files || files.length === 0) { setError('Attach at least one legitimacy document'); return; }

    const form = new FormData();
    form.set('orgId', orgId);
    for (const file of files) form.append('files', file);

    start(async () => {
      const r = await actionApplyForOrgHandle(form);
      if (!r.ok) { setError(r.error); announce(r.error, 'assertive'); return; }
      announce('Application submitted.', 'polite');
      router.refresh();
    });
  }

  return (
    <div>
      <p className="sub" style={{ marginBottom: 12 }}>
        Want this organisation&apos;s exact name — or something close to it — as its esoqo ID?
        Upload documents proving you&apos;re entitled to it (registration certificate, KRA PIN,
        a permit) and our team will review them.
      </p>
      <div className="fld">
        <label className="lab" htmlFor="handle-docs">Legitimacy documents</label>
        <input className="inp" id="handle-docs" type="file" ref={fileInput} multiple
          accept="image/png,image/jpeg,image/webp,application/pdf" disabled={pending} />
        <p className="hint">PDF or photo — registration certificate, permit, or KRA PIN.</p>
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      <button type="button" className="btn btn-o" disabled={pending} onClick={submit}>
        {pending ? 'Submitting…' : 'Submit for review'}
      </button>
    </div>
  );
}

function PickHandle({ orgId, candidates }: { orgId: string; candidates: string[] }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const announce = useAnnounce();

  function pick(handle: string) {
    setError(null);
    setChosen(handle);
    start(async () => {
      const r = await actionConfirmOrgHandle(orgId, handle);
      if (!r.ok) { setError(r.error); setChosen(null); announce(r.error, 'assertive'); return; }
      announce('Handle confirmed.', 'polite');
      router.refresh();
    });
  }

  return (
    <div>
      <p className="sub" style={{ marginBottom: 12 }}>
        Your application was approved. Pick the handle this organisation will use — it can&apos;t
        be changed later.
      </p>
      <div role="radiogroup" aria-label="Candidate esoqo IDs">
        {candidates.map((handle) => (
          <button
            key={handle} type="button" role="radio" aria-checked={chosen === handle}
            disabled={pending} onClick={() => pick(handle)} className="btn"
            style={{ width: '100%', textAlign: 'left', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{handle}</span>
            {chosen === handle && pending ? <Icon name="loader" size={16} /> : <Icon name="arrow-right" size={16} />}
          </button>
        ))}
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
    </div>
  );
}
