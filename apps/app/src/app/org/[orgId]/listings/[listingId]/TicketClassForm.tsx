'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { AMENITY_TAGS, type AmenityTag } from '@esoqo/domain';
import { actionCreateTicketClass } from '../actions';

const AMENITY_LABELS: Record<AmenityTag, string> = {
  WIFI: 'WiFi', SNACKS: 'Snacks', CHARGING: 'Charging', RECLINING: 'Reclining',
  EXTRA_LEGROOM: 'Extra legroom', BLANKET: 'Blanket',
};

export function TicketClassForm({ orgId, listingId }: { orgId: string; listingId: string }) {
  const [name, setName] = useState('');
  const [priceKes, setPriceKes] = useState('');
  const [capacity, setCapacity] = useState('');
  const [seated, setSeated] = useState(false);
  const [amenities, setAmenities] = useState<AmenityTag[]>([]);
  const [amenityNote, setAmenityNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function toggleAmenity(tag: AmenityTag) {
    setAmenities((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionCreateTicketClass(orgId, listingId, { name, priceKes, capacity, seated, amenities, amenityNote });
      if (r.ok) {
        setName(''); setPriceKes(''); setCapacity(''); setSeated(false); setAmenities([]); setAmenityNote('');
        announce('Ticket class added.', 'polite');
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <div className="mcard" style={{ marginBottom: 16 }}>
      <h2><Icon name="tag" size={18} />Add a ticket class</h2>
      <div className="fld">
        <label className="lab" htmlFor="tc-name">Name</label>
        <input className="inp" id="tc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="VIP, Regular, Economy seat" />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="tc-price">Price (KES)</label>
        <input className="inp mono" id="tc-price" inputMode="decimal" value={priceKes} onChange={(e) => setPriceKes(e.target.value)} placeholder="1500" />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="tc-cap">Capacity per occurrence</label>
        <input className="inp mono" id="tc-cap" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="44" />
      </div>
      <div className="fld">
        <label className="lab" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={seated} onChange={(e) => setSeated(e.target.checked)} />
          Numbered seats (bus/coach seat map, reserved theatre seating)
        </label>
      </div>
      <div className="fld">
        <span className="lab">What's included <span className="op">(optional)</span></span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {AMENITY_TAGS.map((tag) => (
            <button key={tag} type="button"
              className={`btn btn-sm ${amenities.includes(tag) ? 'btn-p' : 'btn-o'}`}
              onClick={() => toggleAmenity(tag)}>
              {amenities.includes(tag) ? '✓ ' : ''}{AMENITY_LABELS[tag]}
            </button>
          ))}
        </div>
      </div>
      <div className="fld">
        <label className="lab" htmlFor="tc-note">Other <span className="op">(optional)</span></label>
        <input className="inp" id="tc-note" value={amenityNote} onChange={(e) => setAmenityNote(e.target.value)} placeholder="e.g. USB port" />
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      <button type="button" className="btn btn-p" disabled={pending || !name.trim() || !priceKes || !capacity} onClick={submit}>
        {pending ? 'Adding…' : 'Add ticket class'}
      </button>
    </div>
  );
}
