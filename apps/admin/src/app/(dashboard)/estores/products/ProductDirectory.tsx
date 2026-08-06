'use client';

import { useEffect, useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import {
  actionSuspendProduct, actionReinstateProduct, actionAddProductNote, actionGetProductNotes,
} from '../actions';

interface ProductRow {
  id: string; name: string; category: string | null; status: string;
  priceKes: number; stockQty: number | null;
  store: { id: string; name: string; slug: string; status: string };
  noteCount: number;
}
interface Note { id: string; note: string; createdAt: string }

const STATUS_PILL: Record<string, string> = { ACTIVE: 'p-ok', HIDDEN: 'p-mute', SUSPENDED: 'p-bad' };
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Visible', HIDDEN: 'Hidden by owner', SUSPENDED: 'Suspended' };

export function ProductDirectory({
  rows, total, canModerate, categoryLabels,
}: { rows: ProductRow[]; total: number; canModerate: boolean; categoryLabels: Record<string, string> }) {
  const [moderating, setModerating] = useState<ProductRow | null>(null);

  return (
    <>
      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="grid" size={22} /></span>
            <h3>No products match</h3>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Product</th><th>Store</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    {p.noteCount > 0 && (
                      <span className="sub" style={{ display: 'block', fontSize: '.79rem' }}>
                        <Icon name="message" size={11} />{' '}{p.noteCount} note{p.noteCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </td>
                  <td className="sub">{p.store.name}</td>
                  <td className="sub">{p.category ? (categoryLabels[p.category] ?? p.category) : '—'}</td>
                  <td className="mono">KES {p.priceKes.toLocaleString('en-KE')}</td>
                  <td className="mono sub">{p.stockQty ?? '—'}</td>
                  <td><span className={`pill ${STATUS_PILL[p.status]}`}>{STATUS_LABEL[p.status] ?? p.status}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-o btn-sm" onClick={() => setModerating(p)}>
                      <Icon name="eye" size={13} />{canModerate ? 'Review' : 'View'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="sub" style={{ marginTop: 8 }}>{rows.length} of {total} shown</p>

      {moderating && (
        <ProductModerationModal
          product={moderating} canModerate={canModerate}
          categoryLabel={moderating.category ? (categoryLabels[moderating.category] ?? moderating.category) : null}
          onClose={() => setModerating(null)}
        />
      )}
    </>
  );
}

function ProductModerationModal({
  product, canModerate, categoryLabel, onClose,
}: { product: ProductRow; canModerate: boolean; categoryLabel: string | null; onClose: () => void }) {
  const [status, setStatus] = useState(product.status);
  const [suspendReason, setSuspendReason] = useState('');
  const [showSuspendForm, setShowSuspendForm] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  useEffect(() => {
    let cancelled = false;
    actionGetProductNotes(product.id).then((rows) => { if (!cancelled) { setNotes(rows); setNotesLoading(false); } });
    return () => { cancelled = true; };
  }, [product.id]);

  function suspend() {
    if (!suspendReason.trim()) return;
    setError(null);
    start(async () => {
      const r = await actionSuspendProduct(product.id, suspendReason);
      if (r.ok) { setStatus('SUSPENDED'); setShowSuspendForm(false); announce('Product suspended', 'assertive'); }
      else setError(r.error);
    });
  }

  function reinstate() {
    setError(null);
    start(async () => {
      const r = await actionReinstateProduct(product.id);
      if (r.ok) { setStatus('ACTIVE'); announce('Product reinstated', 'assertive'); }
      else setError(r.error);
    });
  }

  function sendNote() {
    if (!newNote.trim()) return;
    setError(null);
    start(async () => {
      const r = await actionAddProductNote(product.id, newNote);
      if (r.ok) {
        setNotes((prev) => [{ id: crypto.randomUUID(), note: newNote, createdAt: new Date().toISOString() }, ...prev]);
        setNewNote('');
        announce('Comment sent', 'assertive');
      } else setError(r.error);
    });
  }

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="pm-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-hd">
          <div>
            <h2 id="pm-title">{product.name}</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              {product.store.name} · {categoryLabel ?? 'Uncategorised'} · KES {product.priceKes.toLocaleString('en-KE')}
            </p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-bd">
          <div className="ctl" style={{ marginBottom: 18 }}>
            <span className={`pill ${STATUS_PILL[status]}`} style={{ marginRight: 'auto' }}>{STATUS_LABEL[status] ?? status}</span>
            {canModerate && (
              status === 'SUSPENDED' ? (
                <button className="btn btn-o btn-sm" disabled={pending} onClick={reinstate}>
                  <Icon name="check-circle" size={13} />Reinstate
                </button>
              ) : (
                <button className="btn btn-d btn-sm" onClick={() => setShowSuspendForm(true)}>
                  <Icon name="ban" size={13} />Suspend
                </button>
              )
            )}
          </div>

          {showSuspendForm && (
            <div style={{ marginBottom: 18, padding: 14, background: 'var(--paper)', borderRadius: 9 }}>
              <label className="sub" htmlFor="pm-suspend-reason" style={{ display: 'block', marginBottom: 6 }}>
                Why is this being suspended? The owner sees this.
              </label>
              <textarea id="pm-suspend-reason" className="inp" rows={2} style={{ width: '100%', marginBottom: 10 }}
                value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="Misleading photo, price doesn't match description, reported by a buyer…" />
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-d btn-sm" disabled={pending || !suspendReason.trim()} onClick={suspend}>
                  {pending ? 'Suspending…' : 'Confirm suspend'}
                </button>
                <button className="btn btn-o btn-sm" onClick={() => setShowSuspendForm(false)}>Cancel</button>
              </div>
            </div>
          )}

          {error && (
            <p className="pill p-bad" style={{ marginBottom: 14, padding: '10px 13px', whiteSpace: 'normal' }} role="alert">
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}

          <h3 style={{ marginBottom: 10 }}><Icon name="message" size={15} />Comments to the seller</h3>
          {canModerate && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input className="inp" style={{ flex: 1 }} value={newNote} onChange={(e) => setNewNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendNote(); }}
                placeholder="Tell the seller what needs fixing…" aria-label="New comment" />
              <button className="btn btn-p btn-sm" disabled={pending || !newNote.trim()} onClick={sendNote}>
                <Icon name="send" size={13} />Send
              </button>
            </div>
          )}
          {notesLoading ? (
            <p className="sub">Loading…</p>
          ) : notes.length === 0 ? (
            <p className="empty" style={{ padding: '20px 0' }}>No comments yet.</p>
          ) : (
            <div>
              {notes.map((n) => (
                <div key={n.id} className="sig">
                  <span className="av a"><Icon name="shield" size={14} /></span>
                  <div>
                    <p style={{ margin: 0 }}>{n.note}</p>
                    <span className="sub" style={{ fontSize: '.75rem' }}>{new Date(n.createdAt).toLocaleString('en-KE')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-ft">
          <button className="btn btn-o" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
