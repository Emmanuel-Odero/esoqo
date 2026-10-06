'use client';
import { useState, useTransition } from 'react';
import { Icon, Modal } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionDeclareContribution } from './actions';

export function ContributionForm({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function close() {
    setOpen(false); setError(null); setDone(false); setAmount(''); setReference('');
  }

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionDeclareContribution({ orgId, amountKes: amount, reference: reference || undefined });
      if (r.ok) {
        setDone(true);
        announce('Contribution declared. Waiting for an officer to confirm it.', 'polite');
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <>
      <button type="button" className="btn btn-p" onClick={() => setOpen(true)}>
        <Icon name="coins" size={16} />Tell us what you paid in
      </button>

      {open && (
        <Modal
          title="Tell us what you paid in"
          subtitle="In cash at a meeting, or by M-Pesa to the treasurer. An officer confirms it before it's added to the group's balance."
          onClose={close}
          footer={done ? (
            <button type="button" className="btn btn-o" onClick={close}>Close</button>
          ) : (
            <>
              <button type="button" className="btn btn-o" onClick={close} disabled={pending}>Cancel</button>
              <button type="button" className="btn btn-p" disabled={pending || !amount.trim()} onClick={submit}>
                {pending ? 'Sending…' : 'Declare contribution'}
              </button>
            </>
          )}
        >
          {done && !error ? (
            <p style={{ color: 'var(--green)', fontSize: '.9rem', margin: 0 }}>
              <Icon name="check" size={14} /> Declared — waiting on an officer to confirm.
            </p>
          ) : (
            <>
              <div className="fld">
                <label className="lab" htmlFor="ct-amt">Amount (KES)</label>
                <input className="inp mono" id="ct-amt" inputMode="decimal" value={amount}
                  onChange={(e) => setAmount(e.target.value)} placeholder="500" autoFocus />
              </div>
              <div className="fld">
                <label className="lab" htmlFor="ct-ref">M-Pesa code or note (optional)</label>
                <input className="inp" id="ct-ref" value={reference}
                  onChange={(e) => setReference(e.target.value)} placeholder="QGH7…, or 'paid at meeting'" />
              </div>
              {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
