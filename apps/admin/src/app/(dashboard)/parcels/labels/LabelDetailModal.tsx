'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon, LabelPrintSheet, DEFAULT_PRINT_LAYOUT, ScaledLabel } from '@esoqo/ui';
import { actionVoidParcelLabels, actionDeleteParcelLabels, type ParcelLabelRegisterRow } from '../actions';
import { LabelInfoModal } from './LabelInfoModal';
import { batchShortCode } from './batchTitle';
import { ESOQO_LOGO_URL } from './constants';
import { ContactButtons } from '@/components/ContactButtons';

const INPUT: React.CSSProperties = {
  padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6,
};

const STATE_LABEL: Record<string, string> = {
  blank: 'Empty — printed, nothing written on it yet',
  filled: 'Filled in — a handler recorded an item, not yet a booking',
  spent: 'Used — bound to a real parcel',
  voided: 'Withdrawn — can never be booked',
};

/**
 * One label's full detail — the popup a card click opens.
 *
 * Everything the register's old table-row last column could do
 * (Fill in / View parcel) plus what selection's bulk toolbar could do
 * (withdraw, delete) and a single-label print, all in one place, since
 * a card only shows a code and a QR — this is where the rest of what a
 * label carries actually lives.
 */
export function LabelDetailModal({
  label, orgId, onClose, onChanged,
}: {
  label: ParcelLabelRegisterRow;
  orgId?: string;
  onClose: () => void;
  /** Something about this label changed (withdrawn, deleted, edited) — the caller should re-fetch. */
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discardReason, setDiscardReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAct = !label.usedAt && !label.voidedAt;
  const canDelete = canAct && !label.infoAttachedAt;

  function discard() {
    if (!discardReason.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await actionVoidParcelLabels([label.code], discardReason.trim(), orgId);
      if (!res.ok) { setError(res.error); return; }
      onChanged();
      onClose();
    });
  }

  function del() {
    setError(null);
    startTransition(async () => {
      const res = await actionDeleteParcelLabels([label.code], orgId);
      if (!res.ok) { setError(res.error); return; }
      onChanged();
      onClose();
    });
  }

  // Editing hands off to the same form the Mint tab's "Attach info"
  // uses — no separate copy of that form to keep in sync — and its own
  // scrim replaces this one rather than stacking a second backdrop.
  if (editing) {
    return <LabelInfoModal initialCode={label.code} orgId={orgId} onClose={() => { setEditing(false); onChanged(); }} />;
  }

  return (
    <div className="scrim" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="label-detail-title">
        <div className="modal-hd">
          <div>
            <h2 id="label-detail-title" className="mono">{label.code}</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>{STATE_LABEL[label.state] ?? label.state}</p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

        <div className="modal-bd">
          <div style={{ maxWidth: 320, margin: '0 auto 16px' }}>
            <ScaledLabel
              code={label.code} sig={label.sig || undefined} route={label.routeLabel ?? undefined}
              orgName={label.orgName ?? undefined} esoqoLogoUrl={ESOQO_LOGO_URL}
            />
          </div>

          <dl className="dl-grid">
            <dt className="sub">Company</dt><dd>{label.orgName ?? 'Esoqo pool'}</dd>
            <dt className="sub">Item</dt><dd>{label.itemDescription ?? '—'}</dd>
            <dt className="sub">Destination</dt><dd>{label.destination ?? '—'}</dd>
            <dt className="sub">Route</dt><dd>{label.routeLabel ?? '—'}</dd>
            <dt className="sub">Sender</dt>
            <dd>{label.senderName ?? '—'}<ContactButtons msisdn={label.senderMsisdn} /></dd>
            <dt className="sub">Receiver</dt>
            <dd>{label.receiverName ?? '—'}<ContactButtons msisdn={label.receiverMsisdn} /></dd>
            {label.batchId && (
              <>
                <dt className="sub">Batch</dt>
                <dd className="mono">#{batchShortCode(label.batchId)}</dd>
              </>
            )}
            {label.voidedAt && (
              <>
                <dt className="sub">Withdrawn because</dt>
                <dd>{label.voidedReason ?? '—'}</dd>
              </>
            )}
          </dl>

          {error && <p role="alert" style={{ color: 'var(--red)', margin: '10px 0 0' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {label.usedAt ? (
              <Link className="btn btn-o btn-sm" href={`/parcels?q=${encodeURIComponent(label.code)}` as Route}>
                <Icon name="eye" size={13} />View parcel
              </Link>
            ) : !label.voidedAt && (
              <button className="btn btn-o btn-sm" onClick={() => setEditing(true)}>
                <Icon name="qr" size={13} />{label.infoAttachedAt ? 'Edit info' : 'Fill in'}
              </button>
            )}
            <button className="btn btn-o btn-sm" onClick={() => setShowPrint((v) => !v)}>
              <Icon name="print" size={13} />{showPrint ? 'Hide print' : 'Print this label'}
            </button>
            {canAct && !confirmDiscard && !confirmDelete && (
              <button className="btn btn-o btn-sm" onClick={() => setConfirmDiscard(true)}>Withdraw…</button>
            )}
            {canDelete && !confirmDiscard && !confirmDelete && (
              <button className="btn btn-o btn-sm" style={{ color: 'var(--red)' }} onClick={() => setConfirmDelete(true)}>
                Delete permanently…
              </button>
            )}
          </div>

          {confirmDiscard && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={discardReason} onChange={(e) => setDiscardReason(e.target.value)}
                placeholder="Why — e.g. misprinted" aria-label="Why this label is being withdrawn"
                style={{ ...INPUT, flex: 1, minWidth: 200 }} />
              <button className="btn btn-p btn-sm" disabled={pending || !discardReason.trim()} onClick={discard}>
                {pending ? 'Withdrawing…' : 'Withdraw'}
              </button>
              <button className="btn btn-o btn-sm" onClick={() => { setConfirmDiscard(false); setDiscardReason(''); }}>Cancel</button>
            </div>
          )}
          {confirmDelete && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="sub" style={{ color: 'var(--red)', fontSize: '.8rem' }}>
                Permanently removes this label — unlike Withdraw, this cannot be undone.
              </span>
              <button className="btn btn-d btn-sm" disabled={pending} onClick={del}>{pending ? 'Deleting…' : 'Delete'}</button>
              <button className="btn btn-o btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          )}

          {showPrint && (
            <div style={{ marginTop: 14, padding: 12, border: '1.5px dashed var(--line)', borderRadius: 8 }}>
              <button className="btn btn-p btn-sm" onClick={() => window.print()} style={{ marginBottom: 10 }}>
                <Icon name="print" size={13} />Print
              </button>
              <LabelPrintSheet
                labels={[{ code: label.code, sig: label.sig || undefined, route: label.routeLabel ?? undefined }]}
                layout={DEFAULT_PRINT_LAYOUT} orgName={label.orgName ?? undefined} esoqoLogoUrl={ESOQO_LOGO_URL}
                previewScale={0.6}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
