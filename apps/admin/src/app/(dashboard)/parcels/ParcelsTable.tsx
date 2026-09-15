'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import {
  actionBulkAssignParcels, actionSearchCollectors,
  type BulkAssignOutcome, type CollectorLite,
} from './actions';
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
  // The unhappy-path and evidence columns — see dbx.AdminParcelRow's
  // own comment on why an operator needs these to tell "stuck, chase
  // the rider" apart from "we've been three times, phone the receiver".
  DeliveryAttempts: number; LastAttemptAt: string | null; LastAttemptReason: string | null;
  PodPhotoUrl: string | null; PodReceivedByName: string | null; PodMethod: string | null;
  AgentName: string | null; AgentLocationHint: string | null; AgentHeldSince: string | null;
  DeclaredValueKes: string | null; CoverageTierName: string | null;
  // Which courier company is carrying it, and the frozen revenue split.
  // All null on an Esoqo-operated parcel — see Parcel.parcelOrgId.
  ParcelOrgID: string | null; ParcelOrgName: string | null;
  PlatformFeeKes: string | null; OrgEarningsKes: string | null;
  // Null until staff explicitly confirms physical custody — gates the
  // sender/receiver SMS, and this row's own "Confirm received" action.
  // See dbx.ConfirmParcelIntake.
  IntakeConfirmedAt: string | null;
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
  total, page, pageSize, baseQuery,
}: {
  parcels: AdminParcelRow[]; statusLabel: Record<string, string>;
  canAssign: boolean; canCancel: boolean; canRefund: boolean; canEdit: boolean;
  total: number; page: number; pageSize: number;
  baseQuery: { status?: string; q?: string; queue?: string };
}) {
  const [active, setActive] = useState<AdminParcelRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const canManage = canAssign || canCancel || canRefund || canEdit;

  // Only BOOKED parcels can take a collector, so those are the only
  // ones worth selecting. Offering a checkbox on a delivered parcel
  // would be offering an action that can only fail.
  const selectable = canAssign ? parcels.filter((p) => p.Status === 'BOOKED') : [];
  const selectableIds = new Set(selectable.map((p) => p.ID));
  const allSelected = selectable.length > 0 && selectable.every((p) => selected.has(p.ID));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <>
      {selected.size > 0 && (
        <BulkAssignBar
          parcelIds={[...selected]}
          onDone={() => setSelected(new Set())}
          onClear={() => setSelected(new Set())}
        />
      )}
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
                {canAssign && (
                  <th style={{ width: 34 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      disabled={selectable.length === 0}
                      onChange={(e) => setSelected(e.target.checked ? new Set(selectableIds) : new Set())}
                      aria-label="Select every assignable parcel on this page"
                    />
                  </th>
                )}
                <th>Code</th><th>Sender</th><th>Receiver</th>
                <th className="num">Price</th><th>Receipt</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {parcels.map((p) => (
                <tr key={p.ID}>
                  {canAssign && (
                    <td>
                      {selectableIds.has(p.ID) && (
                        <input
                          type="checkbox"
                          checked={selected.has(p.ID)}
                          onChange={() => toggle(p.ID)}
                          aria-label={`Select ${p.Code}`}
                        />
                      )}
                    </td>
                  )}
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
      <Pager total={total} page={page} pageSize={pageSize} shown={parcels.length} baseQuery={baseQuery} />

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

/**
 * "Showing 51–100 of 4,318", and the two links that move through it.
 *
 * The old footer said "200 shown", which is not information — it was
 * the page size restated. Worse, the query behind it was a hard
 * `LIMIT 200` with no offset and no total, so a backlog past 200 was
 * invisible with nothing on screen hinting it existed. An operator
 * could work the list to the bottom and believe they were done.
 */
function Pager({
  total, page, pageSize, shown, baseQuery,
}: {
  total: number; page: number; pageSize: number; shown: number;
  baseQuery: { status?: string; q?: string; queue?: string };
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = (page - 1) * pageSize + shown;

  function hrefFor(target: number): Route {
    const params = new URLSearchParams();
    if (baseQuery.status) params.set('status', baseQuery.status);
    if (baseQuery.q) params.set('q', baseQuery.q);
    if (baseQuery.queue) params.set('queue', baseQuery.queue);
    if (target > 1) params.set('page', String(target));
    const qs = params.toString();
    return (qs ? `/parcels?${qs}` : '/parcels') as Route;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
      <p className="sub" style={{ margin: 0 }}>
        {total === 0
          ? 'Nothing to show'
          : `Showing ${first.toLocaleString('en-KE')}–${last.toLocaleString('en-KE')} of ${total.toLocaleString('en-KE')}`}
        {lastPage > 1 && ` · page ${page} of ${lastPage}`}
      </p>
      {lastPage > 1 && (
        <span style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {/* Rendered as spans rather than disabled links at the ends —
              a link that goes nowhere is still focusable and still
              announced as a link, which is a small lie to a screen
              reader every time someone reaches the last page. */}
          {page > 1
            ? <Link className="btn btn-o btn-sm" href={hrefFor(page - 1)}>Previous</Link>
            : <span className="btn btn-o btn-sm" aria-disabled="true" style={DISABLED}>Previous</span>}
          {page < lastPage
            ? <Link className="btn btn-o btn-sm" href={hrefFor(page + 1)}>Next</Link>
            : <span className="btn btn-o btn-sm" aria-disabled="true" style={DISABLED}>Next</span>}
        </span>
      )}
    </div>
  );
}

const DISABLED: React.CSSProperties = { opacity: 0.45, pointerEvents: 'none' };

/**
 * The bulk bar, shown only while something is selected.
 *
 * Dispatching a rider for a morning round is one collector against
 * eight parcels — until now, eight passes through the detail modal.
 *
 * It reports partial success rather than claiming all-or-nothing,
 * because that's what the endpoint honestly does: every assignment
 * texts a sender and a courier the moment it lands, and no rollback
 * can un-send those.
 */
function BulkAssignBar({
  parcelIds, onDone, onClear,
}: { parcelIds: string[]; onDone: () => void; onClear: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CollectorLite[]>([]);
  const [collector, setCollector] = useState<CollectorLite | null>(null);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BulkAssignOutcome | null>(null);
  const announce = useAnnounce();

  async function search(value: string) {
    setQuery(value);
    setCollector(null);
    setResults(value.trim().length < 2 ? [] : await actionSearchCollectors(value));
  }

  function submit() {
    if (!collector || !when) { setError('Pick a collector and a time.'); return; }
    setError(null);
    setBusy(true);
    void actionBulkAssignParcels(parcelIds, {
      collectorPartyId: collector.PartyID,
      scheduledAt: new Date(when).toISOString(),
    }).then((res) => {
      setBusy(false);
      if (!res.ok) { setError(res.error); return; }
      setOutcome(res.result);
      announce(`${res.result.assigned.length} assigned, ${res.result.failed.length} failed`, 'assertive');
      if (res.result.failed.length === 0) onDone();
    });
  }

  if (outcome) {
    return (
      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <strong>{outcome.assigned.length} assigned</strong>
        {outcome.failed.length > 0 && (
          <>
            <p className="sub" style={{ margin: '6px 0 4px' }}>
              {outcome.failed.length} couldn&apos;t be — the rest went through:
            </p>
            <ul className="sub" style={{ margin: 0, paddingLeft: 18 }}>
              {outcome.failed.map((f) => <li key={f.parcelId}>{f.error}</li>)}
            </ul>
          </>
        )}
        <button className="btn btn-o btn-sm" style={{ marginTop: 10 }}
          onClick={() => { setOutcome(null); onClear(); }}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 14, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <strong style={{ alignSelf: 'center' }}>
        {parcelIds.length} selected
      </strong>
      <label className="sub" style={{ flex: 1, minWidth: 180 }}>Collector
        <input value={collector ? collector.Name : query} onChange={(e) => void search(e.target.value)}
          placeholder="Search by name or phone" style={BULK_INPUT} />
        {results.length > 0 && !collector && (
          <div style={{ border: '1px solid var(--line)', borderRadius: 6, marginTop: 4, maxHeight: 140, overflowY: 'auto' }}>
            {results.map((r) => (
              <button key={r.PartyID} type="button" className="rowbtn"
                onClick={() => { setCollector(r); setResults([]); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', background: 'none', border: 0, cursor: 'pointer' }}>
                {r.Name} <span className="sub">{r.Msisdn ?? ''}</span>
              </button>
            ))}
          </div>
        )}
      </label>
      <label className="sub" style={{ minWidth: 190 }}>Pick-up time
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={BULK_INPUT} />
      </label>
      <button className="btn btn-p btn-sm" disabled={busy} onClick={submit}>
        {busy ? 'Assigning…' : `Assign ${parcelIds.length}`}
      </button>
      <button className="btn btn-o btn-sm" onClick={onClear}>Clear</button>
      {error && <p role="alert" className="sub" style={{ color: 'var(--red)', width: '100%', margin: 0 }}>{error}</p>}
    </div>
  );
}

const BULK_INPUT: React.CSSProperties = {
  display: 'block', width: '100%', padding: '6px 8px',
  border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 2,
};
