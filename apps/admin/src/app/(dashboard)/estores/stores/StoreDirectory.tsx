'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import { actionModerateStore } from '../actions';

interface StoreRow {
  id: string; name: string; slug: string; status: string;
  routingMode: string; posEnabled: boolean; owner: string;
  productCount: number; orderCount: number;
}

const STATUS_PILL: Record<string, string> = { ACTIVE: 'p-ok', DRAFT: 'p-warn', SUSPENDED: 'p-bad' };
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Live', DRAFT: 'Draft', SUSPENDED: 'Suspended' };

export function StoreDirectory({ rows, total, canModerate }: { rows: StoreRow[]; total: number; canModerate: boolean }) {
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function moderate(storeId: string, status: 'ACTIVE' | 'SUSPENDED') {
    setError(null);
    startTransition(async () => {
      const result = await actionModerateStore(storeId, status, status === 'SUSPENDED' ? reason : 'Reinstated by staff');
      if (!result.ok) { setError(result.error); return; }
      setReasonFor(null); setReason('');
    });
  }

  return (
    <>
      <div className="card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr><th>Store</th><th>Owner</th><th>Address</th><th>PoS</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.name}</strong>
                  <span className="sub" style={{ display: 'block' }}>{s.productCount} products · {s.orderCount} orders</span>
                </td>
                <td>{s.owner}</td>
                <td className="mono">{s.routingMode === 'SUBDOMAIN' ? `${s.slug}.esoko.global` : `esoko.global/@${s.slug}`}</td>
                <td>{s.posEnabled ? 'Yes' : 'No'}</td>
                <td><span className={`pill ${STATUS_PILL[s.status]}`}>{STATUS_LABEL[s.status]}</span></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canModerate && (
                    s.status === 'SUSPENDED' ? (
                      <button className="btn btn-o btn-sm" disabled={pending} style={{ marginRight: 8 }}
                        onClick={() => moderate(s.id, 'ACTIVE')}>Reinstate</button>
                    ) : (
                      <button className="btn btn-o btn-sm" style={{ marginRight: 8 }}
                        onClick={() => setReasonFor(s.id)}>Suspend</button>
                    )
                  )}
                  <Link className="btn btn-p btn-sm" href={`/estores/stores/${s.id}` as Route}>
                    <Icon name="eye" size={13} />View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <div className="empty">
          <span className="ico"><Icon name="shop" size={22} /></span>
          <h3>No stores yet</h3>
        </div>
      )}
      <p className="sub" style={{ marginTop: 8 }}>{rows.length} of {total} shown</p>

      {reasonFor && (
        <div className="card" style={{ marginTop: 14, maxWidth: 460 }}>
          <label className="sub" htmlFor="reason" style={{ display: 'block', marginBottom: 6 }}>Reason for suspending</label>
          <textarea
            id="reason" className="inp" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            style={{ minHeight: 80, resize: 'vertical', width: '100%' }}
          />
          {error && <p style={{ color: 'var(--red)', fontSize: '.85rem', marginTop: 6 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button className="btn btn-d btn-sm" disabled={pending} onClick={() => moderate(reasonFor, 'SUSPENDED')}>
              {pending ? 'Suspending…' : 'Suspend store'}
            </button>
            <button className="btn btn-o btn-sm" onClick={() => { setReasonFor(null); setReason(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
