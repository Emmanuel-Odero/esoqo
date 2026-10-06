'use client';

import { useId, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import {
  actionMarkParcelOrgPayoutPaid,
  type ManualParcelOrgPayout,
} from '../../actions';

const inputStyle: React.CSSProperties = {
  padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, width: '100%',
};

function destinationLabel(p: ManualParcelOrgPayout): string {
  switch (p.method) {
    case 'PHONE':
      return p.payoutMsisdn ? `M-Pesa ${p.payoutMsisdn}` : 'M-Pesa (number missing)';
    case 'TILL':
      return p.payoutTillNumber ? `Till ${p.payoutTillNumber}` : 'Till (number missing)';
    case 'PAYBILL':
      return p.payoutPaybillNumber
        ? `Paybill ${p.payoutPaybillNumber}${p.payoutPaybillAccount ? ` / ${p.payoutPaybillAccount}` : ''}`
        : 'Paybill (number missing)';
    case 'BANK':
      return p.payoutBankAccountNumber
        ? `${p.payoutBankCode ?? 'Bank'} ${p.payoutBankAccountNumber}${p.payoutBankAccountName ? ` (${p.payoutBankAccountName})` : ''}`
        : 'Bank account (not set)';
    default:
      return 'No payout method set — onboard one on the company’s profile';
  }
}

export function ManualPayoutsConsole({
  payouts, canPay,
}: {
  payouts: ManualParcelOrgPayout[]; canPay: boolean;
}) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Company</th><th>Parcel</th><th>Destination</th><th>Status</th>
              <th className="num">Owed</th>
              {canPay && <th />}
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <PayoutRow key={p.id} payout={p} canPay={canPay} />
            ))}
            {payouts.length === 0 && (
              <tr>
                <td colSpan={canPay ? 6 : 5} className="sub" style={{ textAlign: 'center', padding: 24 }}>
                  Nothing waiting on a manual payout right now.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PayoutRow({ payout, canPay }: { payout: ManualParcelOrgPayout; canPay: boolean }) {
  const [paying, setPaying] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const noteId = useId();

  if (done) {
    return (
      <tr>
        <td colSpan={canPay ? 6 : 5} className="sub">
          Marked paid — {payout.parcelOrgName} / {payout.parcelCode}
        </td>
      </tr>
    );
  }

  function markPaid() {
    setError(null);
    startTransition(async () => {
      const result = await actionMarkParcelOrgPayoutPaid(payout.id, note.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
    });
  }

  return (
    <tr>
      <td>{payout.parcelOrgName}</td>
      <td className="mono">{payout.parcelCode}</td>
      <td>
        {destinationLabel(payout)}
        {payout.failureReason && (
          <div className="sub" style={{ fontSize: '.78rem' }}>
            <Icon name="alert-triangle" size={12} /> {payout.failureReason}
          </div>
        )}
      </td>
      <td>
        <span className={`pill ${payout.status === 'FAILED' ? 'p-bad' : 'p-warn'}`}>
          {payout.status}
        </span>
      </td>
      <td className="num mono">
        KES {payout.amountKes.toLocaleString('en-KE', { maximumFractionDigits: 0 })}
      </td>
      {canPay && (
        <td>
          {paying ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label className="sr-only" htmlFor={noteId}>Note (e.g. bank reference)</label>
              <input
                id={noteId}
                style={{ ...inputStyle, width: 160 }}
                placeholder="Bank reference / note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button className="btn btn-p btn-sm" disabled={pending} onClick={markPaid}>
                {pending ? 'Saving…' : 'Confirm paid'}
              </button>
              <button className="btn btn-o btn-sm" disabled={pending} onClick={() => setPaying(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn btn-o btn-sm" onClick={() => setPaying(true)}>
              Mark paid
            </button>
          )}
          {error && (
            <div className="sub" style={{ color: 'var(--red)', fontSize: '.78rem' }}>
              {error}
            </div>
          )}
        </td>
      )}
    </tr>
  );
}
