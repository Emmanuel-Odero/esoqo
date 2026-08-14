'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { actionCreateTicketClass } from '../actions';

export function TicketClassForm({ orgId, listingId }: { orgId: string; listingId: string }) {
  const [name, setName] = useState('');
  const [priceKes, setPriceKes] = useState('');
  const [capacity, setCapacity] = useState('');
  const [seated, setSeated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionCreateTicketClass(orgId, listingId, { name, priceKes, capacity, seated });
      if (r.ok) {
        setName(''); setPriceKes(''); setCapacity(''); setSeated(false);
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
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      <button type="button" className="btn btn-p" disabled={pending || !name.trim() || !priceKes || !capacity} onClick={submit}>
        {pending ? 'Adding…' : 'Add ticket class'}
      </button>
    </div>
  );
}
