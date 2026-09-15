'use client';

import { useState, type ReactNode } from 'react';

/**
 * Splits the page into sections instead of one continuous scroll —
 * same role="tablist"/.ctl toggle GroupManager's "How to add them"
 * switcher already uses, so this reads as the same control elsewhere in
 * the app, not a one-off. Every section still renders on the server
 * (this only toggles which one is visible), so switching costs no
 * extra fetch.
 *
 * Takes a list rather than two named slots: what started as "rate card
 * or zones" is now four settings surfaces (pickup points and cover
 * levels joined it), and a component that grows a prop per tab stops
 * being a tab strip.
 */
export function PricingTabs({ tabs }: { tabs: { id: string; label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.id);

  return (
    <div>
      <div role="tablist" aria-label="Parcel settings section" className="ctl"
        style={{ marginBottom: 18, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={active === t.id}
            className={`btn btn-sm ${active === t.id ? 'btn-p' : 'btn-o'}`}
            onClick={() => setActive(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} style={{ display: active === t.id ? 'block' : 'none' }}>{t.content}</div>
      ))}
    </div>
  );
}
