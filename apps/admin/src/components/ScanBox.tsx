'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { extractParcelCode } from '@esoqo/domain';
import { actionResolveScannedCode } from '@/app/(dashboard)/parcels/actions';

/**
 * One box that turns a scanned, typed or pasted code into the right
 * screen.
 *
 * The dashboard could already *print* a label's QR and barcode and had
 * no way at all to read one back — every code in the network was
 * write-only from here. That is backwards for parcel work, where the
 * barcode is the operator's primary input device and typing a code by
 * hand is the fallback, not the norm.
 *
 * No hardware integration is involved, because none is needed: a
 * handheld scanner gun presents itself as a keyboard. It types the
 * code far faster than a human can and presses Enter. So an ordinary
 * focused <input> already accepts gun input perfectly — what this adds
 * is (a) being reachable from anywhere without the operator hunting
 * for the field, and (b) understanding the three shapes a code
 * actually arrives in.
 */

/** Opens the scanner from anywhere. ⌘K / Ctrl-K, or click. */
export function ScanBox() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button type="button" className="tb-scan" onClick={() => setOpen(true)}
        title="Scan or find a code (⌘K)">
        <Icon name="qr" size={14} />
        <span className="tb-scan-label">Scan</span>
        <kbd className="tb-scan-kbd">⌘K</kbd>
      </button>
      {open && <ScanDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ScanDialog({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const announce = useAnnounce();

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const go = useCallback(async (raw: string) => {
    const code = extractParcelCode(raw);
    if (!code) return;
    setBusy(true);
    setError(null);
    const found = await actionResolveScannedCode(code);
    setBusy(false);
    if (found.kind === 'unknown') {
      // Stay open and keep the text selected. A mis-scan is common and
      // the recovery is "scan again", which shouldn't cost a reopen.
      setError(`${code} isn't a parcel or a printed label.`);
      announce(`${code} not found`, 'assertive');
      inputRef.current?.select();
      return;
    }
    announce(`Found ${found.code}`, 'polite');
    onClose();
    // A blank or filled-in label goes to its attach form, not to the
    // parcels ledger where it would show as "no matches" — see
    // actionResolveScannedCode on why the two are distinguishable.
    router.push(found.kind === 'label'
      ? `/parcels/labels?code=${encodeURIComponent(found.code)}`
      : `/parcels?q=${encodeURIComponent(found.code)}`);
  }, [announce, onClose, router]);

  return (
    <div className="scrim" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="scan-title" style={{ maxWidth: 520 }}>
        <div className="modal-hd">
          <div>
            <h2 id="scan-title">Scan or find a code</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              Scan a label with a handheld scanner, or type/paste a code or tracking link.
            </p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-bd">
          <form onSubmit={(e) => { e.preventDefault(); void go(value); }}>
            {/* A scanner gun types the code and presses Enter, which
                submits this form — so gun input needs no special
                handling beyond the field being focused, which it is
                from mount. */}
            <input
              ref={inputRef}
              className="mono"
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(null); }}
              placeholder="PKG-XXXXXX"
              aria-label="Code or tracking link"
              autoComplete="off"
              spellCheck={false}
              style={{
                display: 'block', width: '100%', padding: '10px 12px', fontSize: '1.05rem',
                border: '1.5px solid var(--line)', borderRadius: 8,
              }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
              <button className="btn btn-p btn-sm" type="submit" disabled={busy || !value.trim()}>
                {busy ? 'Looking…' : 'Go'}
              </button>
              <span className="sub" style={{ fontSize: '.8rem' }}>Esc to close</span>
            </div>
            {error && <p role="alert" style={{ color: 'var(--red)', margin: '10px 0 0' }}>{error}</p>}
          </form>
        </div>
      </div>
    </div>
  );
}
