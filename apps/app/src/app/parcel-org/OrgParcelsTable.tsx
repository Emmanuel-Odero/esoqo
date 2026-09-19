'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import type { OrgParcelRow } from '@/lib/parcel-org-session';
import { DemoPhoneSpan } from '@/components/DemoContact';
import { assignOrgParcel } from './actions';

/**
 * A courier company's parcel list.
 *
 * Columns are chosen for what a dispatcher does next, not for
 * completeness: who it's for and where, who's holding it, and whether
 * it has already failed. The customer's price is deliberately absent —
 * the company is paid its own earnings, and what Esoqo charged on top
 * is not theirs to see (core-go doesn't send it either).
 */

const STATUS_LABEL: Record<string, string> = {
  DRAFT_PENDING_PAYMENT: 'Awaiting payment',
  BOOKED: 'Waiting for a rider',
  RECEIVED_AT_COUNTER: 'At the station',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'On the way',
  FAILED_DELIVERY: 'Delivery attempted',
  HELD_AT_AGENT: 'At a pickup point',
  DELIVERED: 'Delivered',
  RETURNED_TO_SENDER: 'Returned to sender',
  CANCELLED: 'Cancelled',
};

function pillClass(status: string): string {
  switch (status) {
    case 'DELIVERED':
      return 'p-ok';
    case 'FAILED_DELIVERY':
    case 'HELD_AT_AGENT':
      return 'p-warn';
    case 'CANCELLED':
    case 'RETURNED_TO_SENDER':
      return 'p-bad';
    default:
      return 'p-info';
  }
}

/** "Today, 2:33 PM" — never a raw ISO string. Africa/Nairobi, because
 *  that is where the parcels are. */
function humanTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const tz = 'Africa/Nairobi';
  const time = d.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const day = (x: Date) => x.toLocaleDateString('en-KE', { timeZone: tz });
  const now = new Date();
  if (day(d) === day(now)) return `Today, ${time}`;
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: tz })}, ${time}`;
}

export function OrgParcelsTable({
  parcels, hasFilter, canDispatch, canSeeEarnings,
}: { parcels: OrgParcelRow[]; hasFilter: boolean; canDispatch: boolean; canSeeEarnings: boolean }) {
  if (parcels.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          <span className="ico"><Icon name="box" size={22} /></span>
          {hasFilter ? (
            <>
              <h3>No parcels match that filter.</h3>
              <p className="sub">
                Your search or status matched nothing on this page.
                {' '}
                <Link href="/parcel-org" className="sub" style={{ textDecoration: 'underline' }}>
                  Clear the filter
                </Link>{' '}
                to see everything.
              </p>
            </>
          ) : (
            <>
              <h3>No parcels here yet.</h3>
              <p className="sub">Parcels routed to your company will show up on this page.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl parcel-table">
          <thead>
            <tr>
              <th>Code</th><th>To</th><th>Route</th><th>Status</th>
              <th>Who has it</th>
              {canSeeEarnings && <th>You earn</th>}
              {canDispatch && <th />}
            </tr>
          </thead>
          <tbody>
            {parcels.map((p) => (
              <Row key={p.id} parcel={p} canDispatch={canDispatch} canSeeEarnings={canSeeEarnings} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  parcel, canDispatch, canSeeEarnings,
}: { parcel: OrgParcelRow; canDispatch: boolean; canSeeEarnings: boolean }) {
  const overdue =
    parcel.slaDeadlineAt
    && ['RECEIVED_AT_COUNTER', 'PICKED_UP', 'IN_TRANSIT'].includes(parcel.status)
    && new Date(parcel.slaDeadlineAt) < new Date();

  return (
    <tr>
      <td data-label="Parcel">
        <span className="mono" style={{ fontWeight: 700 }}>{parcel.code}</span>
        {parcel.externalRef && (
          <span className="sub" style={{ display: 'block' }}>
            Their #: <span className="mono">{parcel.externalRef}</span>
          </span>
        )}
        <span className="sub" style={{ display: 'block' }}>{humanTime(parcel.createdAt)}</span>
      </td>
      <td data-label="Recipient">
        {parcel.receiverName}
        {/* A rider standing at a gate needs to call, not look it up. */}
        <DemoPhoneSpan msisdn={parcel.receiverMsisdn} className="sub mono" />
      </td>
      <td data-label="Route" className="sub">{parcel.originLabel} → {parcel.destinationLabel}</td>
      <td data-label="Status">
        <span className={`pill ${pillClass(parcel.status)}`}>
          {STATUS_LABEL[parcel.status] ?? parcel.status}
        </span>
        {parcel.deliveryAttempts > 0 && (
          <span className="sub" style={{ display: 'block' }}>
            {parcel.deliveryAttempts} failed {parcel.deliveryAttempts === 1 ? 'try' : 'tries'}
          </span>
        )}
        {overdue && <span className="pill p-bad" style={{ marginTop: 4 }}>Past SLA</span>}
      </td>
      <td data-label="In custody with" className="sub">
        {parcel.agentName ?? parcel.holderName ?? 'Nobody yet'}
      </td>
      {canSeeEarnings && (
        <td data-label="You earn" className="mono">
          {parcel.orgEarningsKes
            ? `KES ${Number(parcel.orgEarningsKes).toLocaleString('en-KE')}`
            : '—'}
        </td>
      )}
      {canDispatch && (
        <td data-label="Actions" style={{ textAlign: 'right' }}>
          {(parcel.status === 'BOOKED' || parcel.status === 'RECEIVED_AT_COUNTER') && <AssignButton code={parcel.code} />}
        </td>
      )}
    </tr>
  );
}

/**
 * Assigning by Esoqo ID rather than a rider picker.
 *
 * A dropdown would need the company's whole roster on every row, and
 * the server already refuses any party who isn't on this company's team
 * (see dbx.AssignOrgParcel) — so the narrow input is both less to load
 * and no weaker. A picker is the right follow-up once rosters are big
 * enough to make typing an id annoying.
 */
function AssignButton({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [riderPartyId, setRiderPartyId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return <button className="btn btn-o btn-sm" onClick={() => setOpen(true)}>Assign</button>;
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await assignOrgParcel(code, riderPartyId.trim());
      if (result.ok) setOpen(false);
      else setError(result.error);
    });
  }

  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
      <input
        className="mono"
        style={{ padding: '4px 6px', border: '1.5px solid var(--line)', borderRadius: 6, width: 190 }}
        placeholder="Rider's Esoqo party id"
        aria-label="Rider's Esoqo party id"
        value={riderPartyId}
        onChange={(e) => setRiderPartyId(e.target.value)}
      />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn btn-p btn-sm" disabled={pending || !riderPartyId.trim()} onClick={save}>
          {pending ? 'Assigning…' : 'Assign'}
        </button>
        <button className="btn btn-o btn-sm" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && (
        <span role="alert" className="sub" style={{ color: 'var(--red)' }}>
          <Icon name="alert-circle" size={12} />{error}
        </span>
      )}
    </div>
  );
}
