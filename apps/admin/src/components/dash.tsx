'use client';

import { useEffect, useRef } from 'react';
import { Icon } from '@esoko/ui';

/**
 * Shared dashboard building blocks — extends the existing .kpi/.card/.tbl
 * system in admin.css rather than replacing it, so every page that
 * already uses those classes keeps working unchanged. New pieces:
 * a delta pill, a canvas sparkline, a ranked bar list (feature adoption,
 * revenue by source), a stacked bar (payment-method split), a
 * severity-striped "needs attention" list, and a two-up split metric
 * (GMV vs Esoko's own take — see dal/platform-revenue.ts's own header
 * for why those are never blended into one number).
 */

export function Delta({ pct, tone }: { pct: number; tone: 'good' | 'bad' | 'neutral' }) {
  const dir = pct > 0 ? 'trend-up' : pct < 0 ? 'trend-down' : 'trend-flat';
  return (
    <span className={`delta ${tone}`}>
      <Icon name={dir} size={11} />
      {pct > 0 ? '+' : ''}{pct}%
    </span>
  );
}

export function Sparkline({ data, color = 'var(--green)' }: { data: number[]; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || data.length < 2) return;

    function paint() {
      const c = canvas!;
      const dpr = window.devicePixelRatio || 1;
      const rect = c.getBoundingClientRect();
      const w = rect.width || 200, h = rect.height || 30;
      c.width = w * dpr; c.height = h * dpr;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const resolved = color.startsWith('var(')
        ? getComputedStyle(document.documentElement).getPropertyValue(color.slice(4, -1)).trim() || '#12794A'
        : color;

      const min = Math.min(...data), max = Math.max(...data);
      const pad = 2;
      const pts = data.map((v, i) => {
        const x = pad + (i / (data.length - 1)) * (w - pad * 2);
        const y = h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
        return [x, y] as const;
      });

      const first = pts[0]!;
      const last = pts[pts.length - 1]!;
      ctx.beginPath();
      ctx.moveTo(first[0], h);
      pts.forEach((p) => ctx.lineTo(p[0], p[1]));
      ctx.lineTo(last[0], h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `${resolved}2E`);
      grad.addColorStop(1, `${resolved}00`);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
      ctx.strokeStyle = resolved; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke();

      ctx.beginPath(); ctx.arc(last[0], last[1], 2, 0, Math.PI * 2); ctx.fillStyle = resolved; ctx.fill();
    }

    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [data, color]);

  if (data.length < 2) return null;
  return <canvas className="spark" ref={ref} aria-hidden="true" />;
}

export function RankedList({
  rows, color = 'var(--green)', formatValue = (v) => v.toLocaleString('en-KE'),
}: { rows: { label: string; value: number }[]; color?: string; formatValue?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="ranked">
      {rows.map((r) => (
        <div className="rank-row" key={r.label}>
          <span className="rl" title={r.label}>{r.label}</span>
          <div className="rt"><span style={{ width: `${(r.value / max) * 100}%`, background: color }} /></div>
          <span className="rv">{formatValue(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function StackedBar({
  segments,
}: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div>
      <div className="stackbar">
        {segments.map((s) => (
          <span key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div className="stack-legend">
        {segments.map((s) => (
          <div key={s.label}>
            <i style={{ background: s.color }} />
            {s.label} — {Math.round((s.value / total) * 100)}% · KES {Math.round(s.value).toLocaleString('en-KE')}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface AttentionItem {
  severity: 'crit' | 'warn';
  title: string;
  detail: string;
  href?: string;
}

export function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return <p className="empty" style={{ padding: '24px 0' }}>Nothing needs attention right now.</p>;
  }
  return (
    <div className="alerts">
      {items.map((it, i) => (
        <div className={`alert-row ${it.severity}`} key={i}>
          <span className="stripe" />
          <div className="abody">
            <div className="at">{it.title}</div>
            <div className="ad">{it.detail}</div>
          </div>
          {it.href && <a className="aact mono" href={it.href} style={{ fontSize: '.76rem' }}>Review →</a>}
        </div>
      ))}
    </div>
  );
}

export function SplitPair({
  gmvKes, takeKes,
}: { gmvKes: number; takeKes: number }) {
  return (
    <div className="splitpair">
      <div>
        <span className="sl">Gross volume (GMV)</span>
        <span className="sn">KES {Math.round(gmvKes).toLocaleString('en-KE')}</span>
        <span className="sd">Everything moving through Esoko — giving, treasury, commerce, fees, ticketing.</span>
      </div>
      <div>
        <span className="sl">Esoko&rsquo;s own take</span>
        <span className="sn" style={{ color: 'var(--green)' }}>KES {Math.round(takeKes).toLocaleString('en-KE')}</span>
        <span className="sd">Commission earned on store commerce only, today — see the note on this metric below.</span>
      </div>
    </div>
  );
}
