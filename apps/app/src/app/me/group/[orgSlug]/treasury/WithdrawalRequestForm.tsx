'use client';
import { useState, useTransition } from 'react';
import { Icon, Modal } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionRequestWithdrawal } from './actions';

export function WithdrawalRequestForm({ orgId, leadMinutes }: { orgId: string; leadMinutes: number }) {
  const [open, setOpen] = useState(false);
  const [amountKes, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [payeeMsisdn, setPayeeMsisdn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [opensAt, setOpensAt] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function close() {
    setOpen(false); setError(null); setOpensAt(null);
    setAmount(''); setPurpose(''); setPayeeName(''); setPayeeMsisdn('');
  }

  function submit() {
    setError(null); setOpensAt(null);
    start(async () => {
      const r = await actionRequestWithdrawal({
        orgId, amountKes, purpose, payeeName, payeeMsisdn: payeeMsisdn || undefined,
      });
      if (r.ok) {
        setOpensAt(r.data.standbyOpensAt);
        announce('Withdrawal proposed. Everyone who can approve has been notified.', 'polite');
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <>
      <button type="button" className="btn btn-p" onClick={() => setOpen(true)}>
        <Icon name="bank" size={16} />Ask to pay someone
      </button>

      {open && (
        <Modal
          title="Ask to pay someone"
          subtitle={`Everyone who can approve is told right away, and it waits at least ${leadMinutes} minutes before it can pay out. One "no" stops it.`}
          onClose={close}
          footer={opensAt && !error ? (
            <button type="button" className="btn btn-o" onClick={close}>Close</button>
          ) : (
            <>
              <button type="button" className="btn btn-o" onClick={close} disabled={pending}>Cancel</button>
              <button type="button" className="btn btn-p"
                disabled={pending || !amountKes.trim() || !purpose.trim() || !payeeName.trim()} onClick={submit}>
                {pending ? 'Sending…' : 'Send for approval'}
              </button>
            </>
          )}
        >
          {opensAt && !error ? (
            <p style={{ color: 'var(--green)', fontSize: '.9rem', margin: 0 }}>
              <Icon name="check" size={14} /> Sent. Earliest it can pay out:{' '}
              {new Date(opensAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}.
            </p>
          ) : (
            <>
              <div className="fld">
                <label className="lab" htmlFor="wd-amt">Amount (KES)</label>
                <input className="inp mono" id="wd-amt" inputMode="decimal" value={amountKes}
                  onChange={(e) => setAmount(e.target.value)} placeholder="10000" autoFocus />
              </div>
              <div className="fld">
                <label className="lab" htmlFor="wd-purpose">What is this for?</label>
                <input className="inp" id="wd-purpose" value={purpose}
                  onChange={(e) => setPurpose(e.target.value)} placeholder="Emergency welfare payout to Wanjiku" />
              </div>
              <div className="fld">
                <label className="lab" htmlFor="wd-payee">Who is being paid?</label>
                <input className="inp" id="wd-payee" value={payeeName}
                  onChange={(e) => setPayeeName(e.target.value)} placeholder="Full name" />
              </div>
              <div className="fld">
                <label className="lab" htmlFor="wd-msisdn">Their phone number (optional)</label>
                <input className="inp" id="wd-msisdn" value={payeeMsisdn}
                  onChange={(e) => setPayeeMsisdn(e.target.value)} placeholder="07XX XXX XXX" />
              </div>
              {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
