'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import type { OrgParcelRow } from '@/lib/parcel-org-session';
import { DemoPhoneSpan } from '@/components/DemoContact';
import { assignOrgParcel, exportOrgParcels } from './actions';
import { can, isInFlight, stageFor } from './parcel-stages';

/**
 * The register as an operations explorer, not a static list.
 *
 * Server owns the page window (it fetched exactly these rows with a
 * total); the client owns presentation — sort headers that rewrite the
 * URL, density, CSV export of the visible page, and pagination that
 * keeps every active filter. Sorting never reorders client-side: it
 * navigates, so page 2 of a sorted view is still the server's page 2.
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

interface Props {
  parcels: OrgParcelRow[];
  total: number;
  page: number;
  perPage: number;
  sort: string;
  order: string;
  hasFilter: boolean;
  canDispatch: boolean;
  canSeeEarnings: boolean;
}

function buildHref(
  pathname: string,
  current: URLSearchParams,
  overrides: Record<string, string | null>,
): string {
  const sp = new URLSearchParams(current.toString());
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null || v === '') sp.delete(k);
    else sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function OrgParcelsTable({
  parcels, total, page, perPage, sort, order,
  hasFilter, canDispatch, canSeeEarnings,
}: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [density, setDensity] = useState<'comfortable' | 'compact'>(() =>
    typeof window !== 'undefined' && localStorage.getItem('parcel-org:density') === 'compact' ? 'compact' : 'comfortable',
  );
  // The export fetches the whole filtered set, so it can take a moment
  // and it can fail — both need somewhere to show.
  const [exporting, startExport] = useTransition();
  const [exportError, setExportError] = useState<string | null>(null);

  const params = useMemo(
    () => new URLSearchParams(searchParams.toString()),
    [searchParams],
  );

  function toggleDensity() {
    const next = density === 'comfortable' ? 'compact' : 'comfortable';
    setDensity(next);
    try {
      localStorage.setItem('parcel-org:density', next);
    } catch { /* ignore */ }
  }

  /**
   * Export everything the current filter matches, not the page on
   * screen. It used to write out whatever rows were rendered, so
   * "export the overdue parcels" silently produced the first 25 of
   * them under a filename that didn't say so.
   */
  function exportCsv() {
    setExportError(null);
    startExport(async () => {
      const res = await exportOrgParcels(params.toString());
      if (!res.ok) {
        setExportError(res.error);
        return;
      }
      const header = ['code', 'externalRef', 'receiver', 'phone', 'route', 'status', 'holder', 'attempts', 'created', 'earningsKes'];
      const lines = res.parcels.map((p) => [
        p.code, p.externalRef ?? '', p.receiverName, p.receiverMsisdn,
        `${p.originLabel} → ${p.destinationLabel}`, p.status,
        p.agentName ?? p.holderName ?? '', String(p.deliveryAttempts),
        p.createdAt, p.orgEarningsKes ?? '',
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
      const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Names what it holds: a filtered export and a whole-register
      // export are different files and shouldn't collide in Downloads.
      a.download = hasFilter ? 'parcels-filtered.csv' : 'parcels-all.csv';
      a.click();
      URL.revokeObjectURL(url);
      // Never let a capped export pass as a complete one — a short file
      // looks exactly like a finished one.
      if (res.truncated) {
        setExportError(`Exported the first ${res.parcels.length} rows — narrow the filter for the rest.`);
      }
    });
  }

  const totalPages = Math.max(1, Math.ceil(Math.max(total, parcels.length) / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = total === 0 ? 0 : Math.min(total, (page - 1) * perPage + parcels.length);

  const sortHref = (key: string) => {
    const nextOrder = sort === key ? (order === 'asc' ? 'desc' : 'asc') : key === 'code' || key === 'status' ? 'asc' : 'desc';
    return buildHref(pathname, params, { sort: key, order: nextOrder, page: '1' }) as Route;
  };
  const sortMark = (key: string) => (sort === key ? (order === 'asc' ? ' ↑' : ' ↓') : '');

  if (parcels.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          <span className="ico"><Icon name="box" size={22} /></span>
          {hasFilter ? (
            <>
              <h3>No parcels match that filter.</h3>
              <p className="sub">
                Your search or status matched nothing.
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
    <div className={`card porg-reg-card${density === 'compact' ? ' is-compact' : ''}`} style={{ padding: 0 }}>
      <div className="porg-reg-toolbar">
        <span className="porg-range mono" role="status">
          {total > 0 ? `${from}–${to} of ${total}` : `${parcels.length} shown`}
        </span>
        <span className="porg-reg-tools">
          <label className="porg-perpage">
            <span className="sr-only">Rows per page</span>
            <select
              aria-label="Rows per page"
              value={String(perPage)}
              onChange={(e) => {
                const v = e.target.value;
                startTransition(() => router.push(buildHref(pathname, params, { perPage: v, page: '1' }) as Route));
              }}
            >
              {[10, 25, 50].map((n) => (
                <option key={n} value={String(n)}>{n} / page</option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-o btn-sm" onClick={toggleDensity} aria-pressed={density === 'compact'}>
            <Icon name="grid" size={14} />{density === 'compact' ? 'Comfortable' : 'Compact'}
          </button>
          <button type="button" className="btn btn-o btn-sm" onClick={exportCsv} disabled={exporting}>
            <Icon name="document" size={14} />
            {exporting ? 'Building…' : hasFilter ? `CSV (${total})` : 'CSV'}
          </button>
        </span>
      </div>
      {exportError && (
        <p className="porg-export-note" role="status">
          <Icon name="alert-triangle" size={15} />{exportError}
        </p>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl parcel-table">
          <thead>
            <tr>
              <th><Link className="th-sort" href={sortHref('code')}>Code{sortMark('code')}</Link></th>
              <th>To</th>
              <th>Route</th>
              <th><Link className="th-sort" href={sortHref('status')}>Status{sortMark('status')}</Link></th>
              <th>Who has it</th>
              {canSeeEarnings && <th><Link className="th-sort" href={sortHref('earnings')}>You earn{sortMark('earnings')}</Link></th>}
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
      <div className="porg-pager">
        {page <= 1 ? (
          <span className="btn btn-o btn-sm is-disabled" aria-disabled="true">← Prev</span>
        ) : (
          <Link
            className="btn btn-o btn-sm"
            href={buildHref(pathname, params, { page: String(page - 1) }) as Route}
          >
            ← Prev
          </Link>
        )}
        <span className="mono porg-page" role="status">Page {page} of {totalPages}</span>
        {page >= totalPages ? (
          <span className="btn btn-o btn-sm is-disabled" aria-disabled="true">Next →</span>
        ) : (
          <Link
            className="btn btn-o btn-sm"
            href={buildHref(pathname, params, { page: String(page + 1) }) as Route}
          >
            Next →
          </Link>
        )}
      </div>
    </div>
  );
}

function Row({
  parcel, canDispatch, canSeeEarnings,
}: { parcel: OrgParcelRow; canDispatch: boolean; canSeeEarnings: boolean }) {
  // Both of this row's judgements about the parcel — is it late, can it
  // be assigned — come from the shared state machine rather than status
  // lists written out here. See parcel-stages.ts for why.
  const stage = stageFor(parcel.status);
  const overdue =
    parcel.slaDeadlineAt
    && isInFlight(parcel.status)
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
            {parcel.lastAttemptReason ? ` — ${parcel.lastAttemptReason}` : ''}
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
          {can(stage, 'assign') && <AssignButton code={parcel.code} />}
        </td>
      )}
    </tr>
  );
}

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
