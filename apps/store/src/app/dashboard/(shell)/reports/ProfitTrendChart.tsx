'use client';

import { useState } from 'react';

interface DayPoint { date: string; revenueKes: number; costKes: number; profitKes: number }

/**
 * Revenue split into what it cost and what was kept — one bar per day,
 * stacked: cost on the bottom in a neutral tone, profit on top in green
 * ("green = you and yours", the same semantic the rest of the store app
 * uses for anything that's the merchant's own). Same single KES axis for
 * both, so a stacked bar rather than two lines. A 2px gap separates the
 * segments per the design system's stacked-mark spacing.
 */
export function ProfitTrendChart({ data }: { data: DayPoint[] }) {
  const [hover, setHover] = useState<DayPoint | null>(null);
  const max = Math.max(1, ...data.map((d) => d.revenueKes));
  const totals = data.reduce((n, d) => ({ revenueKes: n.revenueKes + d.revenueKes, costKes: n.costKes + d.costKes, profitKes: n.profitKes + d.profitKes }), { revenueKes: 0, costKes: 0, profitKes: 0 });
  const shown = hover ?? { ...totals, date: '' };
  const label = hover
    ? new Date(hover.date).toLocaleDateString('en-KE', { weekday: 'short', month: 'short', day: 'numeric' })
    : `Last ${data.length} days`;

  return (
    <div>
      <div style={{ marginBottom: 14, display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <div>
          <span className="mono" style={{ fontSize: '1.4rem', fontWeight: 800, display: 'block', color: 'var(--green)' }}>
            KES {shown.profitKes.toLocaleString('en-KE')}
          </span>
          <span className="sub" style={{ fontSize: '.76rem' }}>Profit</span>
        </div>
        <div>
          <span className="mono" style={{ fontSize: '1.4rem', fontWeight: 800, display: 'block', color: 'var(--tx-2)' }}>
            KES {shown.costKes.toLocaleString('en-KE')}
          </span>
          <span className="sub" style={{ fontSize: '.76rem' }}>Cost</span>
        </div>
        <div>
          <span className="mono" style={{ fontSize: '1.4rem', fontWeight: 800, display: 'block', color: 'var(--tx)' }}>
            KES {shown.revenueKes.toLocaleString('en-KE')}
          </span>
          <span className="sub" style={{ fontSize: '.76rem' }}>Revenue</span>
        </div>
        <span className="sub mono" style={{ fontSize: '.74rem', marginLeft: 'auto', alignSelf: 'flex-end' }}>{label}</span>
      </div>

      <div
        role="img"
        aria-label={`Daily revenue split into cost and profit for the last ${data.length} days — total revenue KES ${totals.revenueKes.toLocaleString('en-KE')}, cost KES ${totals.costKes.toLocaleString('en-KE')}, profit KES ${totals.profitKes.toLocaleString('en-KE')}`}
        style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 110 }}
        onMouseLeave={() => setHover(null)}
      >
        {data.map((d) => {
          const costPct = Math.max(0, (d.costKes / max) * 100);
          const profitPct = Math.max(0, (d.profitKes / max) * 100);
          const dim = hover && hover.date !== d.date;
          return (
            <button
              key={d.date}
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onMouseEnter={() => setHover(d)}
              style={{
                flex: 1, minWidth: 2, height: '100%', display: 'flex', flexDirection: 'column',
                justifyContent: 'flex-end', gap: 2, border: 0, padding: 0, background: 'transparent', cursor: 'default',
                opacity: dim ? 0.45 : 1, transition: 'opacity .1s ease',
              }}
            >
              {profitPct > 0 && (
                <span style={{ display: 'block', width: '100%', height: `${profitPct}%`, background: 'var(--green-2)', borderRadius: '3px 3px 0 0' }} />
              )}
              {costPct > 0 && (
                <span style={{ display: 'block', width: '100%', height: `${costPct}%`, background: 'var(--line)', borderRadius: profitPct > 0 ? 0 : '3px 3px 0 0' }} />
              )}
              {costPct === 0 && profitPct === 0 && (
                <span style={{ display: 'block', width: '100%', height: 3, background: 'var(--line)', borderRadius: '3px 3px 0 0' }} />
              )}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <span className="sub mono" style={{ fontSize: '.7rem' }}>
          {new Date(data[0]?.date ?? Date.now()).toLocaleDateString('en-KE', { month: 'short', day: 'numeric' })}
        </span>
        <span className="sub mono" style={{ fontSize: '.7rem' }}>
          {new Date(data[data.length - 1]?.date ?? Date.now()).toLocaleDateString('en-KE', { month: 'short', day: 'numeric' })}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: '.78rem', color: 'var(--tx-2)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--green-2)' }} />Profit
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--line)', border: '1px solid var(--tx-3)' }} />Cost
        </span>
      </div>
    </div>
  );
}
