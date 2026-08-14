'use client';

import { useEffect, useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import {
  actionFlagOrderReroute, actionClearRerouteFlag, actionFindRerouteCandidates, actionReassignOrder,
} from '../actions';

interface OrderRow {
  id: string; buyerName: string; buyerMsisdn: string; status: string;
  totalKes: number; createdAt: string;
  store: { id: string; name: string; slug: string; status: string };
  needsReroute: boolean; rerouteReason: string | null;
  items: { productName: string; quantity: number }[];
}
interface Candidate {
  id: string; name: string; owner: string;
  matchingProducts: { id: string; name: string; priceKes: unknown; stockQty: number | null }[];
}

const STATUS_PILL: Record<string, string> = {
  PENDING_PAYMENT: 'p-warn', PAID: 'p-info', FULFILLED: 'p-ok', CANCELLED: 'p-bad',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Pending payment', PAID: 'Paid', FULFILLED: 'Fulfilled', CANCELLED: 'Cancelled',
};

export function OrderDesk({ rows, total, canReroute }: { rows: OrderRow[]; total: number; canReroute: boolean }) {
  const [active, setActive] = useState<OrderRow | null>(null);

  return (
    <>
      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="basket" size={22} /></span>
            <h3>No orders match</h3>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Buyer</th><th>Store</th><th>Items</th><th>Total</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <strong>{o.buyerName}</strong>
                    <span className="sub" style={{ display: 'block', fontSize: '.79rem' }}>{o.buyerMsisdn}</span>
                  </td>
                  <td className="sub">{o.store.name}</td>
                  <td className="sub">{o.items.map((i) => `${i.quantity}× ${i.productName}`).join(', ')}</td>
                  <td className="mono">KES {o.totalKes.toLocaleString('en-KE')}</td>
                  <td>
                    <span className={`pill ${STATUS_PILL[o.status]}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
                    {o.needsReroute && (
                      <span className="pill p-bad" style={{ marginLeft: 6 }}>
                        <Icon name="alert-triangle" size={11} />Reroute
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-o btn-sm" onClick={() => setActive(o)}>
                      <Icon name="eye" size={13} />{canReroute ? 'Manage' : 'View'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="sub" style={{ marginTop: 8 }}>{rows.length} of {total} shown</p>

      {active && (
        <OrderRerouteModal order={active} canReroute={canReroute} onClose={() => setActive(null)} />
      )}
    </>
  );
}

function OrderRerouteModal({
  order, canReroute, onClose,
}: { order: OrderRow; canReroute: boolean; onClose: () => void }) {
  const [flagged, setFlagged] = useState(order.needsReroute);
  const [reason, setReason] = useState(order.rerouteReason ?? '');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  const canReassign = order.status === 'PENDING_PAYMENT';

  useEffect(() => {
    if (!flagged || !canReassign) return;
    setCandidatesLoading(true);
    actionFindRerouteCandidates(order.id).then((rows) => { setCandidates(rows); setCandidatesLoading(false); });
  }, [flagged, canReassign, order.id]);

  function flag() {
    if (!reason.trim()) return;
    setError(null);
    start(async () => {
      const r = await actionFlagOrderReroute(order.id, reason);
      if (r.ok) { setFlagged(true); announce('Order flagged for reroute', 'assertive'); }
      else setError(r.error);
    });
  }

  function clear() {
    setError(null);
    start(async () => {
      const r = await actionClearRerouteFlag(order.id);
      if (r.ok) { setFlagged(false); setCandidates(null); announce('Reroute flag cleared', 'assertive'); }
      else setError(r.error);
    });
  }

  function reassign(newStoreId: string) {
    setError(null);
    start(async () => {
      const r = await actionReassignOrder(order.id, newStoreId);
      if (r.ok) { announce('Order reassigned', 'assertive'); onClose(); }
      else setError(r.error);
    });
  }

  return (
    <div className="scrim" role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="or-title">
        <div className="modal-hd">
          <div>
            <h2 id="or-title">{order.buyerName}'s order</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              {order.store.name} · KES {order.totalKes.toLocaleString('en-KE')} · {STATUS_LABEL[order.status]}
            </p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-bd">
          <table className="tbl" style={{ marginBottom: 18 }}>
            <tbody>
              <tr><td className="sub" style={{ width: 140 }}>Buyer phone</td><td>{order.buyerMsisdn}</td></tr>
              <tr><td className="sub">Items</td><td>{order.items.map((i) => `${i.quantity}× ${i.productName}`).join(', ')}</td></tr>
              <tr><td className="sub">Placed</td><td className="mono">{new Date(order.createdAt).toLocaleString('en-KE')}</td></tr>
            </tbody>
          </table>

          {!canReroute ? (
            flagged && (
              <p className="pill p-bad" style={{ padding: '10px 13px', whiteSpace: 'normal' }}>
                <Icon name="alert-triangle" size={14} />Flagged for reroute — {order.rerouteReason}
              </p>
            )
          ) : !flagged ? (
            <div>
              <label className="sub" htmlFor="or-reason" style={{ display: 'block', marginBottom: 6 }}>
                This store can't fulfil it — why?
              </label>
              <textarea id="or-reason" className="inp" rows={2} style={{ width: '100%', marginBottom: 10 }}
                value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Out of stock, owner unreachable, store suspended mid-order…" />
              <button className="btn btn-d btn-sm" disabled={pending || !reason.trim()} onClick={flag}>
                <Icon name="alert-triangle" size={14} />Flag for reroute
              </button>
            </div>
          ) : (
            <>
              <p className="pill p-bad" style={{ padding: '10px 13px', whiteSpace: 'normal', marginBottom: 16 }}>
                <Icon name="alert-triangle" size={14} />{order.rerouteReason}
              </p>

              {!canReassign ? (
                <p className="sub">
                  This order is already {(STATUS_LABEL[order.status] ?? order.status).toLowerCase()} — money has moved, so it can't be
                  silently reassigned. Sort this out as a refund or manual settlement with the buyer, then clear the flag.
                </p>
              ) : (
                <>
                  <h3 style={{ marginBottom: 10 }}>Other stores carrying the same items</h3>
                  {candidatesLoading ? (
                    <p className="sub">Looking…</p>
                  ) : !candidates || candidates.length === 0 ? (
                    <p className="empty" style={{ padding: '16px 0' }}>
                      No other active store lists an item with a matching name — add it there first, or clear the flag.
                    </p>
                  ) : (
                    candidates.map((c) => (
                      <div key={c.id} style={{
                        display: 'flex', gap: 10, alignItems: 'center', padding: '11px 13px',
                        border: '1px solid var(--line)', borderRadius: 8, marginBottom: 8,
                      }}>
                        <span style={{ flex: 1 }}>
                          <strong style={{ fontSize: '.9rem', display: 'block' }}>{c.name}</strong>
                          <span className="sub" style={{ fontSize: '.79rem' }}>
                            {c.owner} · {c.matchingProducts.length} matching item{c.matchingProducts.length === 1 ? '' : 's'}
                          </span>
                        </span>
                        <button className="btn btn-p btn-sm" disabled={pending} onClick={() => reassign(c.id)}>
                          Reassign here
                        </button>
                      </div>
                    ))
                  )}
                </>
              )}

              <button className="btn btn-o btn-sm" style={{ marginTop: 14 }} disabled={pending} onClick={clear}>
                Clear reroute flag
              </button>
            </>
          )}

          {error && (
            <p className="pill p-bad" style={{ marginTop: 14, padding: '10px 13px', whiteSpace: 'normal' }} role="alert">
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>
        <div className="modal-ft">
          <button className="btn btn-o" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
