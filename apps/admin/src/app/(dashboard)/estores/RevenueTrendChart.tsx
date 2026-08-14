'use client';

import { useState } from 'react';

interface DayPoint { date: string; revenueKes: number }

/**
 * A day-by-day revenue bar chart. One series, one hue (the same green
 * the Revenue KPI card already uses) — no legend needed, the card title
 * names it. Hover updates a fixed readout above the bars instead of a
 * cursor-following tooltip, which stays legible and simple to keep
 * correct across the responsive breakpoints this app already has.
 */
export function RevenueTrendChart({ data }: { data: DayPoint[] }) {
  const [hover, setHover] = useState<DayPoint | null>(null);
  const max = Math.max(1, ...data.map((d) => d.revenueKes));
  const total = data.reduce((n, d) => n + d.revenueKes, 0);
  const shown = hover ?? { date: '', revenueKes: total };
  const label = hover
    ? new Date(hover.date).toLocaleDateString('en-KE', { weekday: 'short', month: 'short', day: 'numeric' })
    : `Last ${data.length} days`;

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <span className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, display: 'block', color: 'var(--tx)' }}>
          KES {shown.revenueKes.toLocaleString('en-KE')}
        </span>
        <span className="sub" style={{ fontSize: '.79rem' }}>{label}</span>
      </div>

      <div
        role="img"
        aria-label={`Daily revenue for the last ${data.length} days, totalling KES ${total.toLocaleString('en-KE')}`}
        style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90 }}
        onMouseLeave={() => setHover(null)}
      >
        {data.map((d) => (
          <button
            key={d.date}
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onMouseEnter={() => setHover(d)}
            style={{
              flex: 1, minWidth: 2, height: `${Math.max(3, (d.revenueKes / max) * 100)}%`,
              background: d.revenueKes > 0 ? 'var(--green-2)' : 'var(--line)',
              opacity: hover && hover.date !== d.date ? 0.45 : 1,
              borderRadius: '3px 3px 0 0', border: 0, padding: 0, cursor: 'default',
              transition: 'opacity .1s ease',
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <span className="sub mono" style={{ fontSize: '.7rem' }}>
          {new Date(data[0]?.date ?? Date.now()).toLocaleDateString('en-KE', { month: 'short', day: 'numeric' })}
        </span>
        <span className="sub mono" style={{ fontSize: '.7rem' }}>
          {new Date(data[data.length - 1]?.date ?? Date.now()).toLocaleDateString('en-KE', { month: 'short', day: 'numeric' })}
        </span>
      </div>
    </div>
  );
}
