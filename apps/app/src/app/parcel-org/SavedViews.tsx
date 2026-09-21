'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';

/**
 * Saved views — named filter presets for the register.
 *
 * Four built-ins cover the shift's recurring questions ("what's late?",
 * "who do I call?", "what can I load?"). Custom views are whatever
 * filter the person is looking at, pinned to localStorage under one
 * key — no server state, no account sync, survives a sign-out because
 * the shape is just a query string.
 */
const BUILT_INS: { name: string; href: string; hint: string }[] = [
  { name: 'SLA at risk', href: '/parcel-org?overdue=1', hint: 'Past deadline, still moving' },
  { name: 'Needs a call', href: '/parcel-org?status=FAILED_DELIVERY', hint: 'Failed attempts first' },
  { name: 'Morning intake', href: '/parcel-org?status=BOOKED&originMethod=SELF_DROPOFF', hint: 'Senders walking in' },
  { name: 'Ready to load', href: '/parcel-org?status=BOOKED,RECEIVED_AT_COUNTER', hint: 'Fill the next run' },
];

const LS_KEY = 'parcel-org:saved-views';

interface CustomView {
  name: string;
  href: string;
}

export function SavedViews({ currentQuery }: { currentQuery: string }) {
  const [custom, setCustom] = useState<CustomView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setCustom(JSON.parse(raw) as CustomView[]);
    } catch {
      /* private mode — built-ins still work */
    }
  }, []);

  function persist(next: CustomView[]) {
    setCustom(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  const currentHref = `/parcel-org${currentQuery ? `?${currentQuery}` : ''}`;
  const alreadySaved = custom.some((v) => v.href === currentHref);

  return (
    <div className="porg-views" aria-label="Saved views">
      <div className="porg-views-row" role="list">
        {BUILT_INS.map((v) => (
          <Link key={v.name} role="listitem" className="porg-view" href={v.href as Route} title={v.hint}>
            <Icon name="star" size={13} />
            {v.name}
          </Link>
        ))}
        {custom.map((v) => (
          <span key={v.href} role="listitem" className="porg-view porg-view-custom">
            <Link href={v.href as Route}>{v.name}</Link>
            <button
              type="button" aria-label={`Remove ${v.name}`}
              onClick={() => persist(custom.filter((c) => c.href !== v.href))}
            >
              <Icon name="close" size={12} />
            </button>
          </span>
        ))}
      </div>
      {currentQuery && !alreadySaved && (
        naming ? (
          <form
            className="porg-views-save"
            onSubmit={(e) => {
              e.preventDefault();
              const label = name.trim();
              if (!label) return;
              persist([...custom, { name: label, href: currentHref }]);
              setName('');
              setNaming(false);
            }}
          >
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Name this view…" aria-label="Name this view" maxLength={32}
            />
            <button className="btn btn-p btn-sm" type="submit">Save</button>
            <button className="btn btn-o btn-sm" type="button" onClick={() => setNaming(false)}>Cancel</button>
          </form>
        ) : (
          <button className="porg-views-pin" type="button" onClick={() => setNaming(true)}>
            <Icon name="plus" size={13} />Pin this filter as a view
          </button>
        )
      )}
    </div>
  );
}
