'use client';

import type { DispatchPing, DispatchRun } from '@/lib/parcel-org-session';

/** Shared journey maths for the dispatch board: measured speed per
 *  trail segment (haversine over ping timestamps), recorded stops,
 *  last-seen labels and journey progress. Everything here derives from
 *  the run's own pings — no live feed is invented. */

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface TrailSegment {
  from: DispatchPing;
  to: DispatchPing;
  km: number;
  mins: number;
  kmh: number | null;
}

/** Consecutive ping pairs with distance, duration and speed. A null
 *  speed means the two reports share a timestamp — unmeasurable, not zero. */
export function trailSegments(trail: DispatchPing[] | null | undefined): TrailSegment[] {
  if (!Array.isArray(trail)) return [];
  const out: TrailSegment[] = [];
  for (let i = 0; i + 1 < trail.length; i++) {
    const from = trail[i];
    const to = trail[i + 1];
    if (!from || !to) continue;
    const km = haversineKm(from.lat, from.lng, to.lat, to.lng);
    const mins = (new Date(to.at).getTime() - new Date(from.at).getTime()) / 60000;
    out.push({ from, to, km, mins, kmh: mins > 0 ? km / (mins / 60) : null });
  }
  return out;
}

/** Segment colour by measured speed: green flowing, amber slow,
 *  red barely moving. Grey when unmeasurable. */
export function speedColor(kmh: number | null): string {
  if (kmh === null || !Number.isFinite(kmh)) return '#9E9E9E';
  if (kmh >= 35) return '#2E7D32';
  if (kmh >= 12) return '#EF6C00';
  return '#C62828';
}

export interface RecordedStop {
  lat: number;
  lng: number;
  mins: number;
  at: string;
}

/** A stop is consecutive reports within ~250m spanning 5+ minutes —
 *  the vehicle standing still with its phone on, not GPS wobble. */
export function recordedStops(trail: DispatchPing[] | null | undefined): RecordedStop[] {
  if (!Array.isArray(trail)) return [];
  const stops: RecordedStop[] = [];
  let cluster: DispatchPing[] = [];
  const flush = () => {
    const first = cluster[0];
    const last = cluster[cluster.length - 1];
    if (cluster.length < 2 || !first || !last) { cluster = []; return; }
    const mins = (new Date(last.at).getTime() - new Date(first.at).getTime()) / 60000;
    if (mins >= 5) {
      stops.push({
        lat: cluster.reduce((s, p) => s + p.lat, 0) / cluster.length,
        lng: cluster.reduce((s, p) => s + p.lng, 0) / cluster.length,
        mins: Math.round(mins),
        at: last.at,
      });
    }
    cluster = [];
  };
  for (const p of trail) {
    const prev = cluster[cluster.length - 1];
    if (prev && haversineKm(prev.lat, prev.lng, p.lat, p.lng) > 0.25) flush();
    cluster.push(p);
  }
  flush();
  return stops;
}

/** "Active now" under 2 minutes, otherwise "8 min ago" / "2 h ago".
 *  `now` is injectable so live labels can tick from one clock — and so
 *  server rendering can pass a fixed snapshot instead of its own
 *  Date.now() (see useNow in DispatchBoard). */
export function lastSeenLabel(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'No position yet';
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 2) return 'Active now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h ago` : `${h} h ${m} min ago`;
}

export function lastSeenTone(iso: string | null, now: number = Date.now()): 'g' | 'a' | 'r' | undefined {
  if (!iso) return undefined;
  const mins = (now - new Date(iso).getTime()) / 60000;
  if (mins < 10) return 'g';
  if (mins < 45) return 'a';
  return 'r';
}

/** Last measurable segment speed, newest first. */
export function currentSpeedKmh(trail: DispatchPing[] | null | undefined): number | null {
  if (!Array.isArray(trail)) return null;
  for (let i = trail.length - 2; i >= 0; i--) {
    const a = trail[i];
    const b = trail[i + 1];
    if (!a || !b) continue;
    const mins = (new Date(b.at).getTime() - new Date(a.at).getTime()) / 60000;
    if (mins <= 0) continue;
    const kmh = haversineKm(a.lat, a.lng, b.lat, b.lng) / (mins / 60);
    if (Number.isFinite(kmh)) return kmh;
  }
  return null;
}

/** Share of the planned leg already covered, measured against the
 *  straight-line origin → destination distance. Over 100% reads as
 *  "there" rather than a broken percentage. */
export function journeyProgress(run: DispatchRun): number | null {
  if (!run.origin || !run.destination || run.currentLat === null || run.currentLng === null) return null;
  const total = haversineKm(run.origin.lat, run.origin.lng, run.destination.lat, run.destination.lng);
  if (total < 0.5) return null;
  const left = haversineKm(run.currentLat, run.currentLng, run.destination.lat, run.destination.lng);
  return Math.min(1, Math.max(0, 1 - left / total));
}

/** Straight-line km from the run's latest position to its destination.
 *  Label it honestly wherever shown ("straight line") — roads are
 *  longer, and a dispatcher planning fuel on this number should know. */
export function remainingStraightKm(run: DispatchRun): number | null {
  if (!run.destination || run.currentLat === null || run.currentLng === null) return null;
  return haversineKm(run.currentLat, run.currentLng, run.destination.lat, run.destination.lng);
}

/** Total travelled distance along the recorded trail. */
export function distanceCoveredKm(trail: DispatchPing[] | null | undefined): number {
  return trailSegments(trail).reduce((s, seg) => s + seg.km, 0);
}
