'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import type { ShortRoute } from '@/lib/fleet';
import { actionCreateShortRoute } from '../actions';

const inputStyle: React.CSSProperties = {
  padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, width: '100%',
};

/**
 * Pricing — the fare stages a route charges between. Reads are
 * fleet.read (a MANAGER can see the card they operate against); adding
 * one is fleet.write, so only an ADMIN gets the form. The server checks
 * fleet.write again, this only decides what to draw.
 */
export function PricingPanel({
  orgId, routes, canEdit,
}: { orgId: string; routes: ShortRoute[]; canEdit: boolean }) {
  const [name, setName] = useState('');
  const [stages, setStages] = useState<{ name: string; fare: string }[]>([
    { name: '', fare: '' },
    { name: '', fare: '' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addStage() { setStages((s) => [...s, { name: '', fare: '' }]); }
  function removeStage(i: number) { setStages((s) => s.filter((_, idx) => idx !== i)); }
  function setStage(i: number, patch: Partial<{ name: string; fare: string }>) {
    setStages((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  }

  function save() {
    setError(null);
    const clean = stages
      .map((s) => ({ name: s.name.trim(), fareKes: Number(s.fare) }))
      .filter((s) => s.name && Number.isFinite(s.fareKes) && s.fareKes >= 0);
    startTransition(async () => {
      const result = await actionCreateShortRoute(orgId, name, clean);
      if (!result.ok) { setError(result.error); return; }
      setName('');
      setStages([{ name: '', fare: '' }, { name: '', fare: '' }]);
    });
  }

  return (
    <>
      <section className="mcard" style={{ marginBottom: 16 }}>
        <h2><Icon name="coins" size={18} />Fare card</h2>
        {routes.length === 0 ? (
          <p className="sub" style={{ margin: 0 }}>No routes yet{canEdit ? ' — add one below.' : '.'}</p>
        ) : (
          <ul className="papers">
            {routes.map((r) => (
              <li className="paper" key={r.ID}>
                <span className="ps ok" aria-hidden="true"><Icon name="map" size={16} /></span>
                <span className="pt">
                  <span className="t">{r.Name}{r.Active ? '' : ' (inactive)'}</span>
                  <span className="s">
                    {(r.Stages ?? [])
                      .slice()
                      .sort((a, b) => a.Order - b.Order)
                      .map((s) => `${s.Name} KES ${s.FareKES}`)
                      .join(' · ') || 'No stages'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canEdit && (
        <section className="mcard">
          <h2><Icon name="plus" size={18} />Add a route</h2>
          <label className="sub" style={{ display: 'block', marginBottom: 10 }}>
            Route name
            <input style={inputStyle} value={name} placeholder="e.g. CBD — Githurai" onChange={(e) => setName(e.target.value)} />
          </label>
          <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
            {stages.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input style={inputStyle} value={s.name} placeholder={`Stage ${i + 1} (e.g. ${i === 0 ? 'CBD' : 'Ruiru'})`}
                  onChange={(e) => setStage(i, { name: e.target.value })} />
                <input style={{ ...inputStyle, maxWidth: 130 }} className="mono" value={s.fare} inputMode="numeric"
                  placeholder="Fare" onChange={(e) => setStage(i, { fare: e.target.value.replace(/[^\d.]/g, '') })} />
                {stages.length > 2 && (
                  <button className="btn btn-o btn-sm" aria-label={`Remove stage ${i + 1}`} onClick={() => removeStage(i)}>
                    <Icon name="close" size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-o btn-sm" onClick={addStage}><Icon name="plus" size={13} />Add stage</button>
            <button className="btn btn-p btn-sm" disabled={pending || !name.trim()} onClick={save}>
              {pending ? 'Saving…' : 'Save route'}
            </button>
          </div>
          {error && <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', margin: '10px 0 0' }}>{error}</p>}
          <p className="sub" style={{ fontSize: '.78rem', margin: '10px 0 0' }}>
            Fares are what a passenger pays boarding at the first stage and alighting at each later one —
            the same numbers the crew&apos;s fare screen quotes.
          </p>
        </section>
      )}
    </>
  );
}
