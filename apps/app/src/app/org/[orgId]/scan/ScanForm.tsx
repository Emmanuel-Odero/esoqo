'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionCheckIn } from './actions';

/**
 * Manual code entry — a phone camera QR scanner is a real follow-up
 * (getUserMedia + a decode library), but every gate today already
 * carries a barcode-scanner-as-keyboard device, which just needs a
 * focused text input to work. This ships that first.
 */
export function ScanForm({ orgId }: { orgId: string }) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus programmatically rather than the autoFocus prop — same
  // outcome for this scanner-facing screen, but doesn't yank focus
  // away from assistive tech on every navigation (jsx-a11y/no-autofocus).
  useEffect(() => { inputRef.current?.focus(); }, []);

  function submit() {
    if (!code.trim()) return;
    setResult(null);
    start(async () => {
      const r = await actionCheckIn(orgId, { code: code.trim() });
      if (r.ok) {
        setResult({ ok: true, message: 'Checked in — let them through.' });
        announce('Ticket valid, checked in.', 'polite');
      } else {
        setResult({ ok: false, message: r.error });
        announce(r.error, 'assertive');
      }
      setCode('');
      inputRef.current?.focus();
    });
  }

  return (
    <div className="mcard">
      <h2><Icon name="qr" size={18} />Scan a ticket</h2>
      <p style={{ color: 'var(--tx-2)', fontSize: '.9rem', margin: '0 0 14px' }}>
        Scan the ticket's code with a barcode scanner, or type it in.
      </p>
      <div className="fld">
        <label className="lab" htmlFor="scan-code">Ticket code</label>
        <input ref={inputRef} className="inp mono" id="scan-code" value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
      </div>
      <button type="button" className="btn btn-p btn-block" disabled={pending || !code.trim()} onClick={submit}>
        {pending ? 'Checking…' : 'Check in'}
      </button>
      {result && (
        <div className={`note ${result.ok ? 'n-green' : 'n-red'}`} style={{ marginTop: 14 }}>
          <div><p>{result.message}</p></div>
        </div>
      )}
    </div>
  );
}
