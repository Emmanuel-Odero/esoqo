'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionConfirmContribution } from './actions';

export interface ContributionRow {
  id: string;
  amountKes: number;
  status: string;
  contributorName: string;
  isMine: boolean;
  declaredAt: string;
  reference: string | null;
}

export function ContributionsList({ rows, isOfficer }: { rows: ContributionRow[]; isOfficer: boolean }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function confirm(id: string) {
    setPendingId(id);
    start(async () => {
      const r = await actionConfirmContribution(id);
      announce(r.ok ? 'Contribution confirmed and posted' : r.error, r.ok ? 'polite' : 'assertive');
      setPendingId(null);
    });
  }

  if (rows.length === 0) {
    return (
      <div className="mempty">
        <span className="ico"><Icon name="coins" size={22} /></span>
        <p style={{ margin: 0 }}>No contributions yet.</p>
      </div>
    );
  }

  return (
    <>
      {rows.map((c) => (
        <div className="mrow" key={c.id} style={{ alignItems: 'flex-start' }}>
          <span style={{ flex: 1 }}>
            <span className="v" style={{ display: 'block' }}>
              KES {c.amountKes.toLocaleString('en-KE')} — {c.isMine ? 'You' : c.contributorName}
            </span>
            <span className="hint" style={{ margin: '3px 0 0', display: 'block' }}>
              {new Date(c.declaredAt).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' })}
              {c.reference && ` · ${c.reference}`}
            </span>
          </span>
          {c.status === 'CONFIRMED'
            ? <span className="badge b-ok"><Icon name="check" size={11} />Confirmed</span>
            : c.status === 'DECLARED' && isOfficer
              ? (
                <button className="btn btn-o" style={{ minHeight: 36, fontSize: '.82rem' }}
                  disabled={pending && pendingId === c.id} onClick={() => confirm(c.id)}>
                  {pending && pendingId === c.id ? 'Confirming…' : 'Confirm'}
                </button>
              )
              : <span className="badge b-warn">Awaiting confirmation</span>}
        </div>
      ))}
    </>
  );
}
