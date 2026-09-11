'use client';

import { useState, type ReactNode } from 'react';

/**
 * Splits the page into "Rate card" (5 full-height editor panels) and
 * "Zones" (the zone table + distance rate) instead of one continuous
 * scroll — same role="tablist"/.ctl toggle GroupManager's "How to add
 * them" switcher already uses, so this reads as the same control
 * elsewhere in the app, not a one-off. Both sections still render on
 * the server (this only toggles which one is visible), so there's no
 * extra data fetch on switching.
 */
export function PricingTabs({ rateCard, zones }: { rateCard: ReactNode; zones: ReactNode }) {
  const [tab, setTab] = useState<'rate' | 'zones'>('rate');

  return (
    <div>
      <div role="tablist" aria-label="Pricing section" className="ctl" style={{ marginBottom: 18 }}>
        <button type="button" role="tab" aria-selected={tab === 'rate'}
          className={`btn btn-sm ${tab === 'rate' ? 'btn-p' : 'btn-o'}`}
          onClick={() => setTab('rate')}>
          Rate card
        </button>
        <button type="button" role="tab" aria-selected={tab === 'zones'}
          className={`btn btn-sm ${tab === 'zones' ? 'btn-p' : 'btn-o'}`}
          onClick={() => setTab('zones')}>
          Zones &amp; distance pricing
        </button>
      </div>
      <div style={{ display: tab === 'rate' ? 'block' : 'none' }}>{rateCard}</div>
      <div style={{ display: tab === 'zones' ? 'block' : 'none' }}>{zones}</div>
    </div>
  );
}
