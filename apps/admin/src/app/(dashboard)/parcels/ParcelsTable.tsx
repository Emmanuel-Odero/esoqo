'use client';

import { useState } from 'react';
import { Icon } from '@esoko/ui';
import { ParcelDetailModal } from './ParcelDetailModal';

export interface AdminParcelRow {
  ID: string; Code: string; SenderName: string; SenderMsisdn: string;
  ReceiverName: string; ReceiverMsisdn: string; OriginLabel: string; DestinationLabel: string;
  ParcelType: string; Status: string; PriceKes: string | null;
  AssignedCollectorName: string | null; AssignedCollectorMsisdn: string | null;
  CollectionScheduledAt: string | null; CollectionNote: string | null; CreatedAt: string;
  PaymentMethod: string | null; MpesaReceiptCode: string | null;
  RefundStatus: string; RefundedAt: string | null;
  ReceiptConfirmedAt: string | null; ReceiptConditionRating: number | null; ReceiptFeedback: string | null;
  SlaDeadlineAt: string | null; ExceptionNote: string | null; ExceptionFlaggedAt: string | null;
  Notes: string | null; CancellationReason: string | null; CancelledAt: string | null; DeliveredAt: string | null;
}

const FLAGGABLE = new Set(['PICKED_UP', 'IN_TRANSIT']);

/**
 * A row here used to show every field a parcel has — 11 columns wide,
 * long sender/route text wrapping rows to 6+ lines. That's a ledger,
 * not something an operator can scan. This keeps only what answers
 * "which parcel, for how much, paid how" at a glance; everything else
 * (custody, SLA, receipt confirmation, exceptions, cancellation, every
 * CRUD action) lives one click away in ParcelDetailModal instead of
 * being permanently on screen for all 200 rows whether needed or not.
 */
export function ParcelsTable({
  parcels, statusLabel, canAssign, canCancel, canRefund, canEdit,
}: {
  parcels: AdminParcelRow[]; statusLabel: Record<string, string>;
  canAssign: boolean; canCancel: boolean; canRefund: boolean; canEdit: boolean;
}) {
  const [active, setActive] = useState<AdminParcelRow | null>(null);
  const canManage = canAssign || canCancel || canRefund || canEdit;

  return (
    <>
      <div className="card" style={{ padding: 0 }}>
        {parcels.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="basket" size={22} /></span>
            <h3>No parcels match that filter.</h3>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Code</th><th>Sender</th><th>Receiver</th>
                <th className="num">Price</th><th>Receipt</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {parcels.map((p) => (
                <tr key={p.ID}>
                  <td className="mono">{p.Code}</td>
                  <td style={CLIP_150} title={p.SenderName}>
                    {p.SenderName}<span className="sub" style={{ display: 'block' }}>{p.SenderMsisdn}</span>
                  </td>
                  <td style={CLIP_150} title={p.ReceiverName}>
                    {p.ReceiverName}<span className="sub" style={{ display: 'block' }}>{p.ReceiverMsisdn}</span>
                  </td>
                  <td className="num mono">{p.PriceKes ? `KES ${Number(p.PriceKes).toLocaleString('en-KE')}` : '—'}</td>
                  <td className="sub mono" style={{ fontSize: '.79rem' }}>
                    {p.MpesaReceiptCode ?? (p.PaymentMethod ? p.PaymentMethod.replace(/_/g, ' ') : '—')}
                  </td>
                  <td>
                    <span className={`pill ${p.Status === 'DRAFT_PENDING_PAYMENT' ? 'p-warn' : p.Status === 'CANCELLED' ? 'p-bad' : p.Status === 'DELIVERED' ? 'p-ok' : 'p-info'}`}>
                      {statusLabel[p.Status] ?? p.Status}
                    </span>
                    {p.ExceptionNote && (
                      <span className="pill p-bad" style={{ display: 'flex', gap: 4, alignItems: 'center', width: 'fit-content', marginTop: 2 }}>
                        <Icon name="alert-triangle" size={11} />Exception
                      </span>
                    )}
                    {!p.ExceptionNote && p.SlaDeadlineAt && FLAGGABLE.has(p.Status) && new Date(p.SlaDeadlineAt) < new Date() && (
                      <span className="pill p-warn" style={{ display: 'block', width: 'fit-content', marginTop: 2 }}>Past SLA</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-o btn-sm" onClick={() => setActive(p)}>
                      <Icon name="eye" size={13} />{canManage ? 'Manage' : 'View'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="sub" style={{ marginTop: 8 }}>{parcels.length} shown</p>

      {active && (
        <ParcelDetailModal
          parcel={active}
          statusLabel={statusLabel}
          canAssign={canAssign} canCancel={canCancel} canRefund={canRefund} canEdit={canEdit}
          onClose={() => setActive(null)}
        />
      )}
    </>
  );
}

const CLIP_150 = { maxWidth: 150, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const };
