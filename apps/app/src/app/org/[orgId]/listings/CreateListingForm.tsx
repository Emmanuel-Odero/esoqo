'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { actionCreateListing } from './actions';

interface Option { id: string; label: string }

export function CreateListingForm(
  { orgId, vertical, venues, routes }:
  { orgId: string; vertical: 'EVENTS' | 'TRANSPORT'; venues: Option[]; routes: Option[] },
) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();
  const router = useRouter();
  const places = vertical === 'TRANSPORT' ? routes : venues;

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionCreateListing(orgId, {
        title, description: description || undefined,
        venueId: vertical === 'EVENTS' && placeId ? placeId : undefined,
        routeId: vertical === 'TRANSPORT' && placeId ? placeId : undefined,
      });
      if (r.ok) {
        announce('Listing created as a draft.', 'polite');
        router.push(`/org/${orgId}/listings/${r.data.listingId}`);
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <div className="mcard" style={{ marginBottom: 16 }}>
      <h2><Icon name="plus" size={18} />New {vertical === 'TRANSPORT' ? 'trip' : 'event'}</h2>
      <div className="fld">
        <label className="lab" htmlFor="ls-title">Title</label>
        <input className="inp" id="ls-title" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder={vertical === 'TRANSPORT' ? 'Nairobi → Mombasa' : 'Sauti Sol Live'} />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="ls-desc">Description <span className="op">(optional)</span></label>
        <input className="inp" id="ls-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {places.length > 0 && (
        <div className="fld">
          <label className="lab" htmlFor="ls-place">{vertical === 'TRANSPORT' ? 'Route' : 'Venue'} <span className="op">(optional)</span></label>
          <select className="inp" id="ls-place" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
            <option value="">— none yet —</option>
            {places.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
      )}
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      <button type="button" className="btn btn-p" disabled={pending || !title.trim()} onClick={submit}>
        {pending ? 'Creating…' : 'Create draft'}
      </button>
    </div>
  );
}
