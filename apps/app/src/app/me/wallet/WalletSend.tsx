'use client';
import { useState, useTransition } from 'react';
import { Icon, Modal } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionSendMoney } from './actions';

export function WalletSend({ balanceKes }: { balanceKes: number }) {
  const [open, setOpen] = useState(false);
  const [toIdentifier, setToIdentifier] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ receiverName: string; amountKes: number } | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function close() {
    setOpen(false); setError(null); setSent(null); setToIdentifier(''); setAmount(''); setNote('');
  }

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionSendMoney({ toIdentifier, amountKes: Number(amount), note: note.trim() || undefined });
      if (r.status === 'SENT') {
        setSent({ receiverName: r.receiverName, amountKes: r.amountKes });
        announce(`KES ${r.amountKes.toLocaleString('en-KE')} sent to ${r.receiverName}.`, 'polite');
      } else {
        setError(r.message);
        announce(r.message, 'assertive');
      }
    });
  }

  return (
    <>
      <button type="button" className="btn btn-o btn-sm" onClick={() => setOpen(true)}>
        <Icon name="send" size={15} />Send
      </button>

      {open && (
        <Modal
          title="Send to an Esoqo handle"
          onClose={close}
          footer={sent ? (
            <button type="button" className="btn btn-o" onClick={close}>Close</button>
          ) : (
            <>
              <button type="button" className="btn btn-o" disabled={pending} onClick={close}>Cancel</button>
              <button type="button" className="btn btn-p" disabled={pending || !toIdentifier.trim() || !amount.trim()} onClick={submit}>
                {pending ? 'Sending…' : 'Send'}
              </button>
            </>
          )}
        >
          {sent ? (
            <p style={{ color: 'var(--green)', fontSize: '.9rem', margin: 0 }}>
              <Icon name="check" size={14} /> KES {sent.amountKes.toLocaleString('en-KE')} sent to {sent.receiverName} — instant, no fee.
            </p>
          ) : (
            <>
              <p className="hint" style={{ margin: '0 0 10px' }}>
                Available: <strong className="mono">KES {balanceKes.toLocaleString('en-KE')}</strong>. Sending to another
                Esoqo handle is instant and free — no M-Pesa charge, unlike a regular send-money.
              </p>
              <div className="fld">
                <label className="lab" htmlFor="ws-to">Esoqo handle, phone or email</label>
                <input className="inp" id="ws-to" value={toIdentifier}
                  onChange={(e) => setToIdentifier(e.target.value)} placeholder="mutukuka482 or 07XX XXX XXX" autoFocus />
              </div>
              <div className="fld">
                <label className="lab" htmlFor="ws-amt">Amount (KES)</label>
                <input className="inp mono" id="ws-amt" inputMode="decimal" value={amount}
                  onChange={(e) => setAmount(e.target.value)} placeholder="500" />
              </div>
              <div className="fld">
                <label className="lab" htmlFor="ws-note">Note (optional)</label>
                <input className="inp" id="ws-note" value={note}
                  onChange={(e) => setNote(e.target.value)} placeholder="What's this for?" maxLength={140} />
              </div>
              {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
