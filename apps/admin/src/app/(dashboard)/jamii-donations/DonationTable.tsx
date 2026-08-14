'use client';

import { Icon } from '@esoko/ui';

interface Row {
  id: string; status: string; donorName: string; donorMsisdn: string; anonymous: boolean;
  amountKes: number; campaignTitle: string; orgName: string; receiptCode: string | null; createdAt: string;
}

const STATUS: Record<string, [string, string]> = {
  PENDING: ['p-warn', 'Pending'],
  CONFIRMED: ['p-ok', 'Confirmed'],
  FAILED: ['p-bad', 'Failed'],
};

/** Read-only — see the page.tsx comment on why there's no action here. */
export function DonationTable({ rows, q, status }: { rows: Row[]; q: string; status: string }) {
  return (
    <>
      <div className="ctl">
        <form className="srch" style={{ display: 'contents' }}>
          <div className="srch">
            <span className="mg"><Icon name="search" size={16} /></span>
            <input className="inp" name="q" defaultValue={q} aria-label="Search donations"
              placeholder="Donor, phone or campaign…" />
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
            <span className="ico"><Icon name="coins" size={22} /></span>
            <h3>No donations match</h3>
            <p style={{ margin: 0 }}>Gifts made to any campaign appear here as they come in.</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Donor</th><th>Campaign</th><th>Organisation</th><th>Amount</th>
                <th>Receipt</th><th>Status</th><th>Given</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [cls, label] = STATUS[r.status] ?? ['p-mute', r.status];
                return (
                  <tr key={r.id}>
                    <td>
                      {r.anonymous ? 'Anonymous' : r.donorName}
                      <span className="sub mono" style={{ display: 'block' }}>{r.donorMsisdn}</span>
                    </td>
                    <td>{r.campaignTitle}</td>
                    <td>{r.orgName}</td>
                    <td className="mono">KES {r.amountKes.toLocaleString('en-KE')}</td>
                    <td className="mono">{r.receiptCode || '—'}</td>
                    <td><span className={`pill ${cls}`}>{label}</span></td>
                    <td className="sub">{new Date(r.createdAt).toLocaleDateString('en-KE')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
