'use client';

import type { ParcelOrgTrendDay } from '@/lib/parcel-org-session';

/**
 * Seven-day operations strip — bookings vs deliveries per Nairobi day.
 *
 * Pure SVG sparkline (no chart dependency): two polylines, one per
 * series, with a shared max scale. Renders nothing when the backend
 * predates /trends or returns no days — the dashboard must not grow a
 * hole for older core-go builds.
 */
export function TrendsStrip({ days }: { days: ParcelOrgTrendDay[] }) {
  if (!days || days.length === 0) return null;
  const max = Math.max(1, ...days.map((d) => Math.max(d.booked, d.delivered)));
  const W = 280;
  const H = 64;
  const stepX = days.length > 1 ? W / (days.length - 1) : 0;
  const pt = (i: number, v: number) =>
    `${(i * stepX).toFixed(1)},${(H - 6 - (v / max) * (H - 16)).toFixed(1)}`;
  const bookedLine = days.map((d, i) => pt(i, d.booked)).join(' ');
  const deliveredLine = days.map((d, i) => pt(i, d.delivered)).join(' ');
  const totalBooked = days.reduce((s, d) => s + d.booked, 0);
  const totalDelivered = days.reduce((s, d) => s + d.delivered, 0);

  return (
    <section className="card porg-trends" aria-label="Last 7 days">
      <div className="porg-trends-head">
        <div>
          <span className="kicker" style={{ margin: 0 }}>Last 7 days</span>
          <h2>Throughput</h2>
        </div>
        <div className="porg-trends-legend">
          <span><i className="dot dot-booked" />Booked · <strong className="mono">{totalBooked}</strong></span>
          <span><i className="dot dot-delivered" />Delivered · <strong className="mono">{totalDelivered}</strong></span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="porg-spark" role="img" aria-label={`Booked ${totalBooked}, delivered ${totalDelivered} over 7 days`}>
        <polyline points={bookedLine} fill="none" stroke="var(--blue)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={deliveredLine} fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {days.map((d, i) => (
          <circle key={d.day} cx={i * stepX} cy={H - 6 - (d.delivered / max) * (H - 16)} r="3" fill="var(--green)" />
        ))}
      </svg>
      <div className="porg-trends-days" aria-hidden="true">
        {days.map((d) => (
          <span key={d.day}>{d.day.split(' ')[0]}</span>
        ))}
      </div>
    </section>
  );
}
