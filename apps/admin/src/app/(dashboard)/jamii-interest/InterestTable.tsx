'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionReviewInterest, actionApproveInterest } from './actions';

interface Row {
  id: string; status: string; fullName: string; msisdn: string;
  email: string | null; county: string | null; organisationName: string | null;
  matched: boolean; message: string | null; reviewNote: string | null; reviewedAt: string | null;
  createdAt: string;
}

const STATUS: Record<string, [string, string]> = {
  NEW: ['p-warn', 'New'],
  CONTACTED: ['p-info', 'Contacted'],
  CONVERTED: ['p-ok', 'Converted'],
  DISMISSED: ['p-mute', 'Dismissed'],
};

export function InterestTable({
  rows, canWrite, q, status,
}: { rows: Row[]; canWrite: boolean; q: string; status: string }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="ctl">
        <form className="srch" style={{ display: 'contents' }}>
          <div className="srch">
            <span className="mg"><Icon name="search" size={16} /></span>
            <input className="inp" name="q" defaultValue={q} aria-label="Search interest submissions"
              placeholder="Name, phone, email or group…" />
          </div>
          <select className="inp" name="status" aria-label="Filter by status" defaultValue={status}>
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button className="btn btn-o" type="submit"><Icon name="filter" size={15} />Filter</button>
        </form>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="users" size={22} /></span>
            <h3>Nothing here</h3>
            <p style={{ margin: 0 }}>
              Someone shows up here when Our Jamii turns away a non-member and they submit their interest.
            </p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th><th>Phone</th><th>County</th><th>Group / org named</th>
                <th>Status</th><th>Submitted</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [cls, label] = STATUS[r.status] ?? ['p-mute', r.status];
                return (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.fullName}</strong>
                      {r.email && <span className="sub" style={{ display: 'block' }}>{r.email}</span>}
                    </td>
                    <td className="mono">{r.msisdn}</td>
                    <td>{r.county || '—'}</td>
                    <td>{r.organisationName || '—'}</td>
                    <td><span className={`pill ${cls}`}>{label}</span></td>
                    <td className="sub">{new Date(r.createdAt).toLocaleDateString('en-KE')}</td>
                    <td>
                      <button className="btn btn-o btn-sm" onClick={() => setOpenId(r.id)}>
                        {canWrite ? 'Review' : 'View'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {openId && (
        <InterestModal
          row={rows.find((r) => r.id === openId)!}
          canWrite={canWrite}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

function InterestModal({
  row, canWrite, onClose,
}: { row: Row; canWrite: boolean; onClose: () => void }) {
  const [note, setNote] = useState(row.reviewNote ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function setStatus(status: 'CONTACTED' | 'DISMISSED', msg: string) {
    setError(null);
    start(async () => {
      const r = await actionReviewInterest(row.id, status, note);
      if (r.ok) { announce(msg, 'assertive'); onClose(); }
      else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  function approve() {
    setError(null);
    start(async () => {
      const r = await actionApproveInterest(row.id);
      if (r.ok) {
        announce(row.matched ? 'Access granted' : 'Account created and access granted', 'assertive');
        onClose();
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <div className="scrim" role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="im-title">
        <div className="modal-hd">
          <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--amber-t)', color: 'var(--amber)', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <Icon name="users" size={19} />
          </span>
          <div>
            <h2 id="im-title">{row.fullName}</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              Submitted {new Date(row.createdAt).toLocaleString('en-KE')}
            </p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

        <div className="modal-bd">
          <p className={`pill ${row.matched ? 'p-info' : 'p-warn'}`} style={{ padding: '8px 12px', marginBottom: 14 }}>
            <Icon name={row.matched ? 'check-circle' : 'user'} size={13} />
            {row.matched
              ? 'Already a CECF/Esoqo member — approving just grants access'
              : 'New applicant — approving creates their account'}
          </p>

          <div className="grid2" style={{ gap: 14, marginBottom: 16 }}>
            <div>
              <span className="sub" style={{ display: 'block', marginBottom: 4 }}>Phone</span>
              <p className="mono" style={{ margin: 0 }}>{row.msisdn}</p>
            </div>
            <div>
              <span className="sub" style={{ display: 'block', marginBottom: 4 }}>Email</span>
              <p style={{ margin: 0 }}>{row.email || '—'}</p>
            </div>
            <div>
              <span className="sub" style={{ display: 'block', marginBottom: 4 }}>County</span>
              <p style={{ margin: 0 }}>{row.county || '—'}</p>
            </div>
            <div>
              <span className="sub" style={{ display: 'block', marginBottom: 4 }}>Group / org named</span>
              <p style={{ margin: 0 }}>{row.organisationName || '—'}</p>
            </div>
          </div>

          {row.message && (
            <div style={{ marginBottom: 16 }}>
              <span className="sub" style={{ display: 'block', marginBottom: 4 }}>What they said</span>
              <p style={{ margin: 0 }}>{row.message}</p>
            </div>
          )}

          {canWrite && (
            <div>
              <label className="sub" htmlFor="im-note" style={{ display: 'block', marginBottom: 6 }}>
                Note (optional)
              </label>
              <textarea id="im-note" className="inp" rows={2} style={{ width: '100%' }}
                value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="What did you tell them, or why dismiss this?" />
            </div>
          )}

          {error && (
            <p className="pill p-bad" style={{ marginTop: 14, padding: '10px 13px' }} role="alert">
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>

        {canWrite && (
          <div className="modal-ft">
            <button className="btn btn-o" disabled={pending}
              onClick={() => setStatus('DISMISSED', 'Marked dismissed')}>
              <Icon name="ban" size={15} />Dismiss
            </button>
            <button className="btn btn-o" disabled={pending}
              onClick={() => setStatus('CONTACTED', 'Marked contacted')}>
              <Icon name="phone-call" size={15} />Mark contacted
            </button>
            <button className="btn btn-p" disabled={pending} onClick={approve}>
              <Icon name="check" size={15} />
              {pending ? 'Approving…' : row.matched ? 'Approve access' : 'Approve & create account'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
