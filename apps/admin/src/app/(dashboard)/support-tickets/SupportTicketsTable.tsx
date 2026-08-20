'use client';

import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { SUPPORT_TICKET_CATEGORY_LABELS, SUPPORT_TICKET_STATUS_LABELS, SUPPORT_TICKET_STATUSES } from '@esoko/domain';
import { actionUpdateTicketStatus } from './actions';

interface Row {
  id: string; status: string; category: string; categoryOther: string | null;
  subject: string; message: string; staffNote: string | null;
  reporterName: string; reporterEmail: string | null; reporterMsisdn: string | null;
  pageSlug: string | null; orgName: string | null; createdAt: string;
}

const STATUS_TONE: Record<string, [string, string]> = {
  OPEN: ['p-warn', 'Open'],
  IN_PROGRESS: ['p-info', 'In progress'],
  RESOLVED: ['p-ok', 'Resolved'],
  CLOSED: ['p-mute', 'Closed'],
};

export function SupportTicketsTable({ rows, canWrite, status }: { rows: Row[]; canWrite: boolean; status: string }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="ctl">
        <form className="srch" style={{ display: 'contents' }}>
          <select className="inp" name="status" aria-label="Filter by status" defaultValue={status}>
            <option value="">All statuses</option>
            {SUPPORT_TICKET_STATUSES.map((s) => <option key={s} value={s}>{SUPPORT_TICKET_STATUS_LABELS[s]}</option>)}
          </select>
          <button className="btn btn-o" type="submit"><Icon name="filter" size={15} />Filter</button>
        </form>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="message" size={22} /></span>
            <h3>Nothing here</h3>
            <p style={{ margin: 0 }}>No tickets match this filter.</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Subject</th><th>Category</th><th>Reporter</th><th>Status</th><th>Raised</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [tone, label] = STATUS_TONE[r.status] ?? ['p-mute', r.status];
                const open = openId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setOpenId(open ? null : r.id)}>
                      <td><b>{r.subject}</b></td>
                      <td>{r.category === 'OTHER' ? r.categoryOther || 'Other' : SUPPORT_TICKET_CATEGORY_LABELS[r.category as keyof typeof SUPPORT_TICKET_CATEGORY_LABELS]}</td>
                      <td>{r.reporterName}{r.orgName && <div style={{ fontSize: '.78rem', opacity: .7 }}>{r.orgName}</div>}</td>
                      <td><span className={`pill ${tone}`}>{label}</span></td>
                      <td>{new Date(r.createdAt).toLocaleDateString('en-KE')}</td>
                      <td><Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} /></td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={6}>
                          <TicketDetail row={r} canWrite={canWrite} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function TicketDetail({ row, canWrite }: { row: Row; canWrite: boolean }) {
  const [status, setStatus] = useState(row.status);
  const [staffNote, setStaffNote] = useState(row.staffNote ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await actionUpdateTicketStatus(row.id, status as never, staffNote);
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    });
  }

  return (
    <div style={{ padding: '14px 4px' }}>
      <p style={{ whiteSpace: 'pre-wrap' }}>{row.message}</p>
      <div style={{ fontSize: '.82rem', opacity: .8, marginBottom: 12 }}>
        {row.reporterEmail && <div>Email — {row.reporterEmail}</div>}
        {row.reporterMsisdn && <div>Phone — {row.reporterMsisdn}</div>}
        {row.pageSlug && <div>Page — {row.pageSlug}</div>}
      </div>
      {canWrite && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label htmlFor={`status-${row.id}`} style={{ display: 'block', fontSize: '.78rem', marginBottom: 4 }}>Status</label>
            <select id={`status-${row.id}`} className="inp" value={status} onChange={(e) => setStatus(e.target.value)}>
              {SUPPORT_TICKET_STATUSES.map((s) => <option key={s} value={s}>{SUPPORT_TICKET_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor={`note-${row.id}`} style={{ display: 'block', fontSize: '.78rem', marginBottom: 4 }}>Staff note (optional)</label>
            <input id={`note-${row.id}`} className="inp" style={{ width: '100%' }} value={staffNote} onChange={(e) => setStaffNote(e.target.value)} />
          </div>
          <button type="button" className="btn btn-p" disabled={pending} onClick={save}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      {error && <p style={{ color: 'var(--red)', fontSize: '.82rem', marginTop: 8 }}>{error}</p>}
    </div>
  );
}
