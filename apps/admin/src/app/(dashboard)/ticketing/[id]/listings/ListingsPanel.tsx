'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route as RouteT } from 'next';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { actionCreateListing, actionPublishListing } from '../../actions';

interface ListingRow {
  id: string; title: string; status: string;
  venueName: string | null; routeLabel: string | null;
  ticketClassCount: number; scheduleCount: number; createdAt: string;
}

const STATUS_PILL: Record<string, string> = { DRAFT: 'p-warn', PUBLISHED: 'p-ok', SUSPENDED: 'p-bad', CANCELLED: 'p-bad' };

export function ListingsPanel({
  orgId, canPublish, venues, routes, listings,
}: {
  orgId: string; canPublish: boolean;
  venues: { id: string; name: string }[]; routes: { id: string; label: string }[];
  listings: ListingRow[];
}) {
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [venueId, setVenueId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionCreateListing(orgId, {
        title, description: description || undefined,
        venueId: venueId || undefined, routeId: routeId || undefined,
      });
      if (r.ok) {
        setTitle(''); setDescription(''); setVenueId(''); setRouteId('');
        announce('Listing created.', 'polite');
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  function setStatus(listingId: string, status: 'PUBLISHED' | 'SUSPENDED' | 'CANCELLED') {
    start(async () => {
      const r = await actionPublishListing(orgId, listingId, status);
      if (!r.ok) announce(r.error, 'assertive');
    });
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2><Icon name="calendar" size={18} />New listing</h2>
        <p style={{ color: 'var(--tx-2)', fontSize: '.9rem', margin: '0 0 14px' }}>
          Created as a draft. Add ticket classes and schedule at least one occurrence before
          publishing.
        </p>
        <div className="fld">
          <label className="lab" htmlFor="l-title">Title</label>
          <input className="inp" id="l-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="l-desc">Description</label>
          <input className="inp" id="l-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {venues.length > 0 && (
          <div className="fld">
            <label className="lab" htmlFor="l-venue">Venue</label>
            <select className="inp" id="l-venue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
              <option value="">None</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        )}
        {routes.length > 0 && (
          <div className="fld">
            <label className="lab" htmlFor="l-route">Route</label>
            <select className="inp" id="l-route" value={routeId} onChange={(e) => setRouteId(e.target.value)}>
              <option value="">None</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
        )}
        {venues.length === 0 && routes.length === 0 && (
          <p className="note n-blue" style={{ marginTop: 4 }}>
            <Icon name="info" size={14} /> Add a venue or route first, on the &ldquo;Venues &amp;
            routes&rdquo; tab, if this listing needs one.
          </p>
        )}
        {error && (
          <p className="pill p-bad" style={{ marginTop: 10, padding: '10px 13px', whiteSpace: 'normal' }} role="alert">
            <Icon name="alert-circle" size={14} />{error}
          </p>
        )}
        <button className="btn btn-p btn-sm" style={{ marginTop: 12 }} disabled={pending || !title.trim()} onClick={submit}>
          <Icon name="plus" size={14} />{pending ? 'Creating…' : 'Create listing'}
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {listings.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="calendar" size={22} /></span>
            <h3>No listings yet</h3>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Title</th><th>Venue / route</th><th className="num">Classes</th><th className="num">Occurrences</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {listings.map((l) => (
                <tr key={l.id}>
                  <td><strong>{l.title}</strong></td>
                  <td>{l.venueName || l.routeLabel || '—'}</td>
                  <td className="num">{l.ticketClassCount}</td>
                  <td className="num">{l.scheduleCount}</td>
                  <td><span className={`pill ${STATUS_PILL[l.status]}`}>{l.status}</span></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canPublish && l.status === 'DRAFT' && (
                      <button className="btn btn-p btn-sm" disabled={pending} style={{ marginRight: 8 }}
                        onClick={() => setStatus(l.id, 'PUBLISHED')}>Publish</button>
                    )}
                    {canPublish && l.status === 'PUBLISHED' && (
                      <button className="btn btn-o btn-sm" disabled={pending} style={{ marginRight: 8 }}
                        onClick={() => setStatus(l.id, 'SUSPENDED')}>Suspend</button>
                    )}
                    {canPublish && l.status === 'SUSPENDED' && (
                      <button className="btn btn-p btn-sm" disabled={pending} style={{ marginRight: 8 }}
                        onClick={() => setStatus(l.id, 'PUBLISHED')}>Reinstate</button>
                    )}
                    <Link className="btn btn-o btn-sm" href={`/ticketing/${orgId}/listings/${l.id}` as RouteT}>
                      <Icon name="eye" size={13} />Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
