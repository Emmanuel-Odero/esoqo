'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionSignWithdrawal } from './actions';

interface Props {
  withdrawalId: string;
  amountKes: number;
  purpose: string;
  payeeName: string;
}

/**
 * The PIN-signature popup. Deliberately has no "sign later" or offline
 * path — see the treasury proposal doc: a signature is a live,
 * present-tense act, never queued.
 */
export function WithdrawalSignForm({ withdrawalId, amountKes, purpose, payeeName }: Props) {
  const [open, setOpen] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit(decision: 'APPROVE' | 'REJECT') {
    setError(null);
    start(async () => {
      const r = await actionSignWithdrawal({ withdrawalId, decision, pin });
      if (r.ok) {
        setOpen(null); setPin('');
        announce(decision === 'APPROVE' ? 'Signed — approved' : 'Signed — rejected, this withdrawal is halted', 'assertive');
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button type="button" className="btn btn-p" style={{ minHeight: 40, fontSize: '.85rem' }}
          onClick={() => { setOpen('APPROVE'); setError(null); }}>
          <Icon name="check" size={14} />Sign — approve
        </button>
        <button type="button" className="btn btn-o" style={{ minHeight: 40, fontSize: '.85rem' }}
          onClick={() => { setOpen('REJECT'); setError(null); }}>
          <Icon name="ban" size={14} />Sign — reject
        </button>
      </div>

      {open && (
        <div className="scrim" role="presentation"
          style={{ position: 'fixed', inset: 0, background: 'rgba(10,46,77,.55)', display: 'grid', placeItems: 'center', padding: 24, zIndex: 200 }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="wd-sign-title"
            style={{ background: '#fff', borderRadius: 14, maxWidth: 440, width: '100%', padding: 26 }}>
            <h2 id="wd-sign-title" style={{ marginBottom: 10 }}>
              {open === 'APPROVE' ? 'Approve this withdrawal?' : 'Reject this withdrawal?'}
            </h2>
            <p style={{ color: 'var(--tx-2)', fontSize: '.93rem' }}>
              KES {amountKes.toLocaleString('en-KE')} to <strong>{payeeName}</strong> — {purpose}
            </p>
            {open === 'REJECT' && (
              <p style={{ color: 'var(--tx-2)', fontSize: '.9rem' }}>
                One rejection stops this immediately, for everyone.
              </p>
            )}
            <div className="fld">
              <label className="lab" htmlFor="wd-pin"><Icon name="lock" size={15} />Enter your PIN to sign</label>
              <input className="inp mono" id="wd-pin" type="password" maxLength={6} inputMode="numeric"
                autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} />
            </div>
            {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
            <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="btn btn-o" onClick={() => { setOpen(null); setPin(''); }}>Cancel</button>
              <button className="btn btn-p" disabled={pending || pin.trim().length < 4}
                onClick={() => submit(open)}>
                {pending ? 'Signing…' : open === 'APPROVE' ? 'Approve' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
