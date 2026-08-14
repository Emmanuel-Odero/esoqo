'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { actionModerateCampaign } from './actions';

interface Row {
  id: string; slug: string; title: string; status: string; goalKes: number;
  orgName: string; pageSlug: string; donationCount: number; createdAt: string;
}

const STATUS: Record<string, [string, string]> = {
  DRAFT: ['p-warn', 'Draft'],
  ACTIVE: ['p-ok', 'Active'],
  COMPLETED: ['p-info', 'Completed'],
  CANCELLED: ['p-bad', 'Cancelled'],
};

export function CampaignTable({
  rows, canModerate, q, status,
}: { rows: Row[]; canModerate: boolean; q: string; status: string }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="ctl">
        <form className="srch" style={{ display: 'contents' }}>
          <div className="srch">
            <span className="mg"><Icon name="search" size={16} /></span>
            <input className="inp" name="q" defaultValue={q} aria-label="Search campaigns"
              placeholder="Title or organisation…" />
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
            <span className="ico"><Icon name="trend-up" size={22} /></span>
            <h3>No campaigns match</h3>
            <p style={{ margin: 0 }}>A page&rsquo;s team opens one from their own dashboard.</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Campaign</th><th>Organisation</th><th>Goal</th><th>Donations</th>
                <th>Status</th><th>Opened</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [cls, label] = STATUS[r.status] ?? ['p-mute', r.status];
                return (
                  <tr key={r.id}>
                    <td><strong>{r.title}</strong></td>
                    <td>{r.orgName}</td>
                    <td className="mono">KES {r.goalKes.toLocaleString('en-KE')}</td>
                    <td>{r.donationCount}</td>
                    <td><span className={`pill ${cls}`}>{label}</span></td>
                    <td className="sub">{new Date(r.createdAt).toLocaleDateString('en-KE')}</td>
                    <td>
                      <button className="btn btn-o btn-sm" onClick={() => setOpenId(r.id)}>
                        {canModerate ? 'Manage' : 'View'}
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
        <CampaignModal
          row={rows.find((r) => r.id === openId)!}
          canModerate={canModerate}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

function CampaignModal({
  row, canModerate, onClose,
}: { row: Row; canModerate: boolean; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) { announce(msg, 'assertive'); onClose(); }
      else { setError(r.error ?? 'That did not work'); announce(r.error ?? '', 'assertive'); }
    });

  return (
    <div className="scrim" role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cm-title">
        <div className="modal-hd">
          <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--green-t)', color: 'var(--green)', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <Icon name="trend-up" size={19} />
          </span>
          <div>
            <h2 id="cm-title">{row.title}</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>{row.orgName} · goal KES {row.goalKes.toLocaleString('en-KE')}</p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

        <div className="modal-bd">
          <p style={{ margin: '0 0 16px' }}>
            <a href={`http://localhost:3004/o/${row.pageSlug}/c/${row.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-o btn-sm">
              <Icon name="arrow-right" size={14} />View public campaign
            </a>
          </p>

          {confirming && (
            <div style={{ marginBottom: 16 }}>
              <label className="sub" htmlFor="cm-reason" style={{ display: 'block', marginBottom: 6 }}>
                Reason for cancelling (recorded in the audit log)
              </label>
              <textarea id="cm-reason" className="inp" rows={2} style={{ width: '100%' }}
                value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this campaign being cancelled?" />
            </div>
          )}

          {error && (
            <p className="pill p-bad" style={{ marginTop: 4, padding: '10px 13px' }} role="alert">
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>

        {canModerate && (
          <div className="modal-ft">
            {row.status === 'CANCELLED' ? (
              <button className="btn btn-p" disabled={pending}
                onClick={() => run(() => actionModerateCampaign(row.id, 'ACTIVE', 'Reinstated by staff'), 'Campaign reinstated')}>
                <Icon name="check-circle" size={15} />Reinstate
              </button>
            ) : !confirming ? (
              <button className="btn btn-o" disabled={pending} onClick={() => setConfirming(true)}>
                <Icon name="ban" size={15} />Cancel campaign
              </button>
            ) : (
              <button className="btn btn-d" disabled={pending || !reason.trim()}
                onClick={() => run(() => actionModerateCampaign(row.id, 'CANCELLED', reason), 'Campaign cancelled')}>
                Confirm cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
