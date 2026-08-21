'use client';

import { useId } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, RadialBarChart, RadialBar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PolarAngleAxis,
} from 'recharts';

/**
 * Real chart primitives — Recharts, SVG, React-first — replacing the
 * hand-rolled canvas/div-bar approximations this dashboard used before.
 * Every chart resolves its colour straight from admin.css's CSS custom
 * properties (`var(--green)` etc.), so this stays the same palette,
 * just rendered properly: gradient-filled areas, real donuts, a real
 * gauge, grouped/ranked bars with an actual axis instead of a plain div.
 */

const TOOLTIP_STYLE = {
  background: '#fff', border: '1px solid var(--line)', borderRadius: 8,
  fontSize: '.82rem', boxShadow: 'var(--sh-s)', padding: '8px 12px',
};
const TOOLTIP_LABEL_STYLE = { fontFamily: 'var(--font-mono)', fontSize: '.68rem', color: 'var(--tx-3)', marginBottom: 4 };

function keFormatter(v: number) { return `KES ${Math.round(v).toLocaleString('en-KE')}`; }

/** Recharts' Tooltip formatter hands back `ValueType`, not `number` — narrow it once here
 *  instead of at every call site. */
function asNumber(v: unknown): number { return typeof v === 'number' ? v : Number(v) || 0; }

/** Inline, axis-less area sparkline for a KPI card — the compact
 *  cousin of TrendChart below. */
export function MiniTrend({ data, color = 'var(--green-2)' }: { data: number[]; color?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  if (data.length < 2) return null;
  const points = data.map((y, i) => ({ x: i, y }));
  return (
    <div style={{ width: '100%', height: 32, marginTop: 8 }}>
      <ResponsiveContainer>
        <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`mt-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="y" stroke={color} strokeWidth={1.7} fill={`url(#mt-${id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface TrendSeries { key: string; color: string; label: string }

/** Full trend panel — grid, axis, tooltip, legend when there's more
 *  than one series. `data` rows carry a `date`/`label` field plus one
 *  numeric field per series key. */
export function TrendChart({
  data, series, height = 220, valueFormatter = (v: number) => v.toLocaleString('en-KE'),
}: { data: Record<string, string | number>[]; series: TrendSeries[]; height?: number; valueFormatter?: (v: number) => string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient id={`tc-${id}-${s.key}`} key={s.key} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.32} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--tx-3)' }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--tx-3)' }} tickLine={false} axisLine={false} width={44} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} formatter={(v: unknown) => valueFormatter(asNumber(v))} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: '.78rem', paddingTop: 8 }} />}
          {series.map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2}
              fill={`url(#tc-${id}-${s.key})`} isAnimationActive={false} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Vertical day-by-day bars — the "revenue by day" shape, with a real
 *  axis and tooltip instead of a hover-tracked div. */
export function DailyBarChart({
  data, color = 'var(--green-2)', height = 140, currency = false,
}: { data: { date: string; value: number }[]; color?: string; height?: number; currency?: boolean }) {
  const rows = data.map((d) => ({
    ...d, label: new Date(d.date).toLocaleDateString('en-KE', { month: 'short', day: 'numeric' }),
  }));
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickLine={false} axisLine={{ stroke: 'var(--line)' }}
            interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11, fill: 'var(--tx-3)' }} tickLine={false} axisLine={false} width={currency ? 54 : 34} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE}
            formatter={(v: unknown) => (currency ? keFormatter(asNumber(v)) : asNumber(v).toLocaleString('en-KE'))} />
          <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranked horizontal bars — feature adoption, revenue by source, top
 *  pages: anywhere a label competes for space against a value. */
export function RankedBarChart({
  rows, color = 'var(--green-2)', height, currency = false,
}: { rows: { label: string; value: number }[]; color?: string; height?: number; currency?: boolean }) {
  const h = height ?? Math.max(120, rows.length * 34);
  return (
    <div style={{ width: '100%', height: h }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={10}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 12, fill: 'var(--tx)' }}
            tickLine={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} cursor={{ fill: 'var(--paper)' }}
            formatter={(v: unknown) => (currency ? keFormatter(asNumber(v)) : asNumber(v).toLocaleString('en-KE'))} />
          <Bar dataKey="value" fill={color} radius={[0, 5, 5, 0]} isAnimationActive={false} barSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Donut with a centred total — the "parts of a whole" shape (payment
 *  method split, status breakdown). */
export function DonutChart({
  segments, centerLabel, size = 168, currency = false,
}: {
  segments: { label: string; value: number; color: string }[];
  centerLabel?: { value: string; sub: string }; size?: number; currency?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ width: size, height: size, position: 'relative', flex: 'none' }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={segments} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="98%"
              paddingAngle={segments.length > 1 ? 2 : 0} strokeWidth={0} isAnimationActive={false}>
              {segments.map((s) => <Cell key={s.label} fill={s.color} />)}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE}
              formatter={(v: unknown) => (currency ? keFormatter(asNumber(v)) : asNumber(v).toLocaleString('en-KE'))} />
          </PieChart>
        </ResponsiveContainer>
        {centerLabel && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', textAlign: 'center',
          }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.15rem' }}>{centerLabel.value}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.62rem', color: 'var(--tx-3)', marginTop: 2 }}>{centerLabel.sub}</span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 140 }}>
        {segments.map((s) => {
          const total = segments.reduce((n, x) => n + x.value, 0) || 1;
          return (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.82rem' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flex: 'none' }} />
              <span style={{ color: 'var(--tx)', flex: 1 }}>{s.label}</span>
              <span className="mono" style={{ color: 'var(--tx-2)', fontSize: '.78rem' }}>
                {Math.round((s.value / total) * 100)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A single-value radial gauge — completion rate, PoS adoption, any
 *  "how close to the target" metric. */
export function Gauge({
  pct, color = 'var(--green)', size = 128, label,
}: { pct: number; color?: string; size?: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ width: size, height: size, position: 'relative' }}>
      <ResponsiveContainer>
        <RadialBarChart
          data={[{ value: clamped, fill: color }]}
          innerRadius="72%" outerRadius="100%" startAngle={90} endAngle={-270}
          barSize={10}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" cornerRadius={20} background={{ fill: 'var(--paper)' }} isAnimationActive={false} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', textAlign: 'center',
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: size > 100 ? '1.5rem' : '1.1rem' }}>
          {Math.round(clamped)}%
        </span>
        {label && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.6rem', color: 'var(--tx-3)', marginTop: 2 }}>{label}</span>}
      </div>
    </div>
  );
}
