'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { actionSign, actionWaive } from './actions';

export interface Signature { name: string; decision: 'APPROVE' | 'REJECT'; at: string }
export interface PaymentRow {
  id: string; status: string; reference: string | null; amountKes: number | null;
  method: string | null; declaredAt: string | null; approveCount: number;
  signatures: Signature[]; person: string; county: string;
}

const STATUS: Record<string, [string, string]> = {
  NOT_DECLARED: ['p-mute', 'Will pay later'],
  DECLARED: ['p-warn', 'Awaiting signature'],
  UNDER_REVIEW: ['p-info', 'Part-signed'],
  CONFIRMED: ['p-ok', 'Confirmed'],
  REJECTED: ['p-bad', 'Rejected'],
  WAIVED: ['p-mute', 'Waived'],
};

export function PaymentQueue({
  rows, total, threshold, canApprove, approverCount,
}: {
  rows: PaymentRow[]; total: number; threshold: number;
  canApprove: boolean; approverCount: number;
}) {
  const [open, setOpen] = useState<PaymentRow | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');

  const view = rows.filter((r) => {
    if (filter && r.status !== filter) return false;
    if (q && !`${r.person} ${r.reference ?? ''} ${r.county}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <div className="ctl">
        <div className="srch">
          <span className="mg"><Icon name="search" size={16} /></span>
          <input className="inp" value={q} onChange={(e) => setQ(e.target.value)}
            aria-label="Search payments" placeholder="Name, M-Pesa code or county…" />
        </div>
        <select className="inp" value={filter} onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(STATUS).map(([k, [, label]]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <span className="sub">{view.length} of {total}</span>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {view.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="coins" size={22} /></span>
            <h3>No payments to review</h3>
            <p style={{ margin: 0 }}>
              Declared payments appear here the moment someone enters an M-Pesa code during
              registration.
            </p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Who</th><th>Reference</th><th className="num">Amount</th>
                <th>Signatures</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {view.map((r) => {
                const [cls, label] = STATUS[r.status] ?? ['p-mute', r.status];
                return (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.person}</strong>
                      <span className="sub" style={{ display: 'block' }}>{r.county}</span>
                    </td>
                    <td className="mono">{r.reference ?? '—'}</td>
                    <td className="num">{r.amountKes ? r.amountKes.toLocaleString('en-KE') : '—'}</td>
                    <td>
                      <div className="sigbar" style={{ margin: 0, maxWidth: 90 }}>
                        {Array.from({ length: threshold }, (_, i) => (
                          <span key={i} className={i < r.approveCount ? 'on' : ''} />
                        ))}
                      </div>
                      <span className="sub mono" style={{ fontSize: '.74rem' }}>
                        {r.approveCount} of {threshold}
                      </span>
                    </td>
                    <td><span className={`pill ${cls}`}>{label}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-o btn-sm" onClick={() => setOpen(r)}>
                        <Icon name="eye" size={14} />Review
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <PaymentModal
          row={open} threshold={threshold} canApprove={canApprove}
          approverCount={approverCount} onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function PaymentModal({
  row, threshold, canApprove, approverCount, onClose,
}: {
  row: PaymentRow; threshold: number; canApprove: boolean;
  approverCount: number; onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [waiving, setWaiving] = useState(false);
  const announce = useAnnounce();

  const settled = row.status === 'CONFIRMED' || row.status === 'REJECTED' || row.status === 'WAIVED';
  const remaining = Math.max(0, threshold - row.approveCount);

  function sign(decision: 'APPROVE' | 'REJECT') {
    setError(null);
    start(async () => {
      const r = await actionSign(row.id, decision, note || undefined);
      if (r.ok) {
        announce(decision === 'APPROVE'
          ? `Signature recorded. ${Math.max(0, remaining - 1)} more needed.`
          : 'Payment rejected.', 'assertive');
        onClose();
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  function waive() {
    if (!note.trim()) { setError('A reason is required to waive a fee'); return; }
    start(async () => {
      const r = await actionWaive(row.id, note);
      if (r.ok) { announce('Fee waived', 'assertive'); onClose(); }
      else setError(r.error);
    });
  }

  return (
    <div className="scrim" role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="pm-title">
        <div className="modal-hd">
          <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--blue-t)', color: 'var(--blue)', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <Icon name="coins" size={19} />
          </span>
          <div>
            <h2 id="pm-title">{row.person}</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>{row.county}</p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

        <div className="modal-bd">
          <table className="tbl" style={{ marginBottom: 20 }}>
            <tbody>
              <tr><td className="sub">Method</td><td>{row.method ?? 'Not stated'}</td></tr>
              <tr><td className="sub">Reference</td><td className="mono">{row.reference ?? '—'}</td></tr>
              <tr><td className="sub">Amount declared</td>
                <td className="mono">{row.amountKes ? `KES ${row.amountKes.toLocaleString('en-KE')}` : '—'}</td></tr>
              <tr><td className="sub">Declared</td>
                <td>{row.declaredAt ? new Date(row.declaredAt).toLocaleString('en-KE') : '—'}</td></tr>
            </tbody>
          </table>

          <h3 style={{ marginBottom: 4 }}>Signatures</h3>
          <p className="sub" style={{ marginBottom: 10 }}>
            {settled
              ? 'This payment is settled. The chain below is the permanent record.'
              : `${remaining} more ${remaining === 1 ? 'signature' : 'signatures'} needed. ${approverCount} people can sign.`}
          </p>
          <div className="sigbar">
            {Array.from({ length: threshold }, (_, i) => (
              <span key={i} className={i < row.approveCount ? 'on' : ''} />
            ))}
          </div>

          {row.signatures.length === 0 ? (
            <p className="sub" style={{ padding: '14px 0' }}>Nobody has signed yet.</p>
          ) : (
            <div>
              {row.signatures.map((s) => (
                <div className="sig" key={`${s.name}-${s.at}`}>
                  <span className={`av ${s.decision === 'APPROVE' ? 'a' : 'r'}`}>
                    {s.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                  </span>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: '.91rem' }}>{s.name}</strong>
                    <span className="sub" style={{ display: 'block', fontSize: '.8rem' }}>
                      {new Date(s.at).toLocaleString('en-KE')}
                    </span>
                  </div>
                  <span className={`pill ${s.decision === 'APPROVE' ? 'p-ok' : 'p-bad'}`}>
                    <Icon name={s.decision === 'APPROVE' ? 'check' : 'close'} size={12} />
                    {s.decision === 'APPROVE' ? 'Approved' : 'Rejected'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!settled && canApprove && (
            <div style={{ marginTop: 18 }}>
              <label className="sub" htmlFor="pm-note" style={{ display: 'block', marginBottom: 6 }}>
                Note {waiving ? '(required to waive)' : '(optional)'}
              </label>
              <textarea id="pm-note" className="inp" rows={2} value={note}
                onChange={(e) => setNote(e.target.value)} style={{ width: '100%' }}
                placeholder={waiving ? 'Why is this fee being waived?' : 'I checked the M-Pesa statement for 27 July…'} />
            </div>
          )}

          {error && (
            <p className="pill p-bad" style={{ marginTop: 14, padding: '10px 13px' }} role="alert">
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>

        <div className="modal-ft">
          {!settled && canApprove ? (
            waiving ? (
              <>
                <button className="btn btn-o" onClick={() => setWaiving(false)}>Cancel</button>
                <button className="btn btn-d" onClick={waive} disabled={pending}>Waive this fee</button>
              </>
            ) : (
              <>
                <button className="btn btn-o" style={{ marginRight: 'auto' }}
                  onClick={() => setWaiving(true)}>Waive fee</button>
                <button className="btn btn-d" onClick={() => sign('REJECT')} disabled={pending}>
                  <Icon name="close" size={15} />No receipt found
                </button>
                <button className="btn btn-p" onClick={() => sign('APPROVE')} disabled={pending}>
                  <Icon name="check" size={15} />Sign approval
                </button>
              </>
            )
          ) : (
            <button className="btn btn-o" onClick={onClose}>Close</button>
          )}
        </div>
      </div>
    </div>
  );
}
