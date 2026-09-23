'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import { Icon } from '@esoqo/ui';
import type { DispatchRun } from '@/lib/parcel-org-session';
import { DemoPhoneSpan } from '@/components/DemoContact';
import { lastSeenLabel, lastSeenTone, recordedStops, speedColor, trailSegments } from './dispatch-stats';

// The fleet marker: the vehicle's number plate as the label, so the
// board reads at a glance which bus is where. A divIcon again (never
// the stock marker image — same Leaflet-in-Next bundling reason the
// other maps document).
//
// The dot carries the fix freshness (green live, amber ageing, red
// stale, grey no timestamp) — a dispatcher scanning the map sees
// which positions to trust without opening anything. Selected runs
// keep the dark-blue ring so highlight survives the recolour.
function freshnessColor(tone: 'g' | 'a' | 'r' | undefined): string {
  switch (tone) {
    case 'g': return '#2E7D32';
    case 'a': return '#EF6C00';
    case 'r': return '#C62828';
    default: return '#9E9E9E';
  }
}

function plateIcon(plate: string, selected: boolean, tone: 'g' | 'a' | 'r' | undefined) {
  const dot = freshnessColor(tone);
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;gap:6px;transform:translate(-50%,-50%);white-space:nowrap;">` +
      `<div style="width:14px;height:14px;border-radius:50%;background:${dot};` +
      `border:2px solid ${selected ? '#0D47A1' : 'white'};box-shadow:0 0 3px rgba(0,0,0,.55)"></div>` +
      `<div style="background:${selected ? '#0D47A1' : '#fff'};color:${selected ? '#fff' : '#0D47A1'};` +
      `border:1.5px solid #0D47A1;border-radius:6px;padding:2px 7px;font-size:11px;font-weight:800;` +
      `font-family:ui-monospace,monospace;box-shadow:0 1px 3px rgba(0,0,0,.3)">${plate}</div></div>`,
    iconSize: [0, 0],
  });
}

function dotIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 2px rgba(0,0,0,.5)"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

const ORIGIN_ICON = dotIcon('#2E7D32');
const DESTINATION_ICON = dotIcon('#C62828');
const CHECKPOINT_ICON = L.divIcon({
  className: '',
  html: `<div style="width:20px;height:20px;border-radius:50%;background:#4A148C;border:2px solid white;` +
    `display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:800;` +
    `box-shadow:0 0 3px rgba(0,0,0,.55)">!</div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});
const STOP_ICON = dotIcon('#EF6C00');

/** Well-known traffic-police checkpoints along the corridors this
 *  company's runs actually drive (Nairobi–Nakuru highway, Thika Rd,
 *  Ngong Rd). Static points of interest — where to expect a stop and
 *  plan the route — not a live feed. */
const CHECKPOINTS: { name: string; corridor: string; lat: number; lng: number }[] = [
  { name: 'Rironi checkpoint', corridor: 'Nairobi – Nakuru highway', lat: -1.1489, lng: 36.5967 },
  { name: 'Kamandura checkpoint', corridor: 'Nairobi – Nakuru highway', lat: -1.1042, lng: 36.5531 },
  { name: 'Kinungi checkpoint', corridor: 'Nairobi – Nakuru highway', lat: -0.9231, lng: 36.4402 },
  { name: 'Naivasha checkpoint', corridor: 'Nairobi – Nakuru highway', lat: -0.7173, lng: 36.4345 },
  { name: 'Gilgil weighbridge', corridor: 'Nairobi – Nakuru highway', lat: -0.4956, lng: 36.3043 },
  { name: 'Lanet checkpoint', corridor: 'Nakuru approach', lat: -0.3301, lng: 36.1189 },
  { name: 'Juja checkpoint', corridor: 'Thika Rd', lat: -1.1028, lng: 37.0148 },
  { name: 'Blue Post checkpoint', corridor: 'Thika Rd', lat: -1.0241, lng: 37.0681 },
  { name: 'Garden Estate checkpoint', corridor: 'Thika Rd', lat: -1.2215, lng: 36.8912 },
  { name: 'Dagoretti Corner checkpoint', corridor: 'Ngong Rd', lat: -1.3012, lng: 36.7621 },
];

// Nairobi CBD — only when no run has any position yet.
const DEFAULT_CENTER: [number, number] = [-1.2864, 36.8172];

/** Refit the view when the selection (or the set of runs) changes —
 *  but never on plain position ticks, so the map doesn't yank while
 *  somebody is inspecting a run, and never while locked — a locked
 *  camera stays where the dispatcher left it. Instant (no animation)
 *  so a Locate fly-to issued in the same commit wins deterministically. */
function FitBounds({ points, fitKey, locked }: { points: [number, number][]; fitKey: string; locked: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (locked || points.length === 0) return;
    map.fitBounds(L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng))), { padding: [36, 36], animate: false });
  }, [map, fitKey, locked]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** The card → map direction of the board's sync: fly to the run the
 *  dispatcher just picked in the list. Runs without a dep array and is
 *  guarded by a flown key, so the 30s poll re-renders never re-fly —
 *  only a fresh Locate tap moves the camera. */
function FocusRunner({ runs, focus, locked }: { runs: DispatchRun[]; focus: { id: string; n: number } | null; locked: boolean }) {
  const map = useMap();
  const flown = useRef('');
  useEffect(() => {
    if (!focus || locked) return;
    const key = `${focus.id}:${focus.n}`;
    if (flown.current === key) return;
    const run = runs.find((r) => r.id === focus.id);
    if (!run) return;
    const trail = Array.isArray(run.trail) ? run.trail : [];
    const lastPing = trail[trail.length - 1];
    const target: [number, number] | null =
      run.currentLat !== null && run.currentLng !== null
        ? [run.currentLat, run.currentLng]
        : lastPing
          ? [lastPing.lat, lastPing.lng]
          : run.origin
            ? [run.origin.lat, run.origin.lng]
            : run.destination
              ? [run.destination.lat, run.destination.lng]
              : null;
    if (!target) return;
    flown.current = key;
    map.flyTo(target, Math.max(map.getZoom(), 9), { duration: 0.9 });
  });
  return null;
}

/** Leaflet reads its interaction options once at construction, so
 *  locking toggles the live handlers instead of remounting the map
 *  (which would lose the dispatcher's current view). Markers and
 *  popups stay clickable — lock freezes the camera, not inspection. */
function LockControl({ locked }: { locked: boolean }) {
  const map = useMap();
  useEffect(() => {
    const method = locked ? 'disable' : 'enable';
    map.scrollWheelZoom[method]();
    map.doubleClickZoom[method]();
    map.touchZoom[method]();
    map.boxZoom[method]();
    map.keyboard[method]();
    map.dragging[method]();
  }, [map, locked]);
  return null;
}

/** Leaflet measures its container once; a CSS height change (the
 *  expand toggle) leaves half-grey tiles until it re-measures. */
function SizeFix({ tall }: { tall: boolean }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(t);
  }, [map, tall]);
  return null;
}

/** Dispatcher-held map prefs. This module only ever renders
 *  client-side (ssr:false), so window access here is safe. */
function readMapFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function runStatusLabel(status: string): string {
  switch (status) {
    case 'LOADING': return 'Loading';
    case 'DEPARTED': return 'On the road';
    case 'ARRIVED': return 'Arrived';
    case 'CANCELLED': return 'Cancelled';
    default: return status;
  }
}

/**
 * The fleet map section: header with live counts, the map itself with
 * layer toggles, the speed legend, and the runs that have no GPS yet.
 *
 * Every run handed to this section appears in exactly one of two
 * places — a marker on the map, or a row in the "still at the shed"
 * list below it. A loading run has no position by definition, so
 * without that list it would silently vanish from the section that is
 * supposed to show the whole fleet — which is how a map becomes a bug
 * instead of a feature.
 */
export function FleetDispatchMapInner({
  runs, selectedId, focus, onSelect,
}: {
  runs: DispatchRun[];
  selectedId: string | null;
  /** Locate request from the run list (id + nonce) — the map flies to it. */
  focus: { id: string; n: number } | null;
  onSelect: (id: string) => void;
}) {
  const [showTrails, setShowTrails] = useState(true);
  const [showCheckpoints, setShowCheckpoints] = useState(true);
  const [tall, setTall] = useState(false);
  // Collapse the whole map card (tiles stop loading too); lock freezes
  // the camera — no scroll/pinch/double-click zoom, no drag, no
  // auto-refit, no Locate fly-to. Both persist per browser.
  const [collapsed, setCollapsed] = useState(() => readMapFlag('dispatch.map.collapsed'));
  const [locked, setLocked] = useState(() => readMapFlag('dispatch.map.locked'));
  useEffect(() => {
    try { window.localStorage.setItem('dispatch.map.collapsed', collapsed ? '1' : '0'); } catch { /* private mode */ }
  }, [collapsed]);
  useEffect(() => {
    try { window.localStorage.setItem('dispatch.map.locked', locked ? '1' : '0'); } catch { /* private mode */ }
  }, [locked]);
  // A Locate tap from the run list always re-opens the map — flying to
  // a run nobody can see would read as a dead button.
  useEffect(() => {
    if (focus) setCollapsed(false);
  }, [focus]);

  const onRoad = runs.filter((r) => r.status === 'DEPARTED');
  const loading = runs.filter((r) => r.status === 'LOADING');
  const positioned = runs.filter((r) => r.currentLat !== null && r.currentLng !== null);
  // Runs with a marker on the map vs runs accounted for below it.
  const withoutGps = runs.filter((r) => r.currentLat === null || r.currentLng === null);
  // Exceptions first, even in the header: a stale fix is the thing to
  // look at before the fresh dots.
  const stale = positioned.filter((r) => lastSeenTone(r.currentAt) !== 'g');

  const allPoints: [number, number][] = [];
  for (const r of runs) {
    if (r.origin) allPoints.push([r.origin.lat, r.origin.lng]);
    if (r.destination) allPoints.push([r.destination.lat, r.destination.lng]);
    if (r.currentLat !== null && r.currentLng !== null) allPoints.push([r.currentLat, r.currentLng]);
    if (showTrails) {
      for (const p of (Array.isArray(r.trail) ? r.trail : [])) allPoints.push([p.lat, p.lng]);
    }
  }
  const center: [number, number] = allPoints.length
    ? [allPoints.reduce((s, p) => s + p[0], 0) / allPoints.length, allPoints.reduce((s, p) => s + p[1], 0) / allPoints.length]
    : DEFAULT_CENTER;

  return (
    <section id="fleet-map" className={`porg-map${locked && !collapsed ? ' is-locked' : ''}`} aria-label="Fleet map">
      <div className="porg-map-head">
        <div>
          <h2>Fleet map</h2>
          <p className="sub" role="status">
            {onRoad.length} on the road · {loading.length} loading
            {stale.length > 0 && <> · {stale.length} stale</>}
            {withoutGps.length > 0 && <> · {withoutGps.length} without GPS yet</>}
            {locked && !collapsed && <> · locked</>}
          </p>
        </div>
        <div className="porg-map-toggles" role="group" aria-label="Map controls">
          <button
            type="button"
            className="btn btn-o btn-sm"
            onClick={() => setCollapsed((v) => !v)}
            aria-pressed={collapsed}
            aria-expanded={!collapsed}
          >
            {collapsed ? 'Show map' : 'Hide map'}
          </button>
          {!collapsed && (
            <button
              type="button"
              className={`btn btn-o btn-sm${locked ? ' is-on' : ''}`}
              onClick={() => setLocked((v) => !v)}
              aria-pressed={locked}
              title={locked ? 'Unlock: zoom, pan and auto-follow work again' : 'Lock: the camera stops moving — no zoom, no pan, no auto-refit'}
            >
              <Icon name="lock" size={14} />{locked ? 'Unlock' : 'Lock'}
            </button>
          )}
        </div>
      </div>
      {!collapsed && (
      <>
      <div className="porg-map-toggles porg-map-layers" role="group" aria-label="Map layers">
        <label className="pfield-check">
          <input type="checkbox" checked={showTrails} onChange={(e) => setShowTrails(e.target.checked)} />
          <span>Trails</span>
        </label>
        <label className="pfield-check">
          <input type="checkbox" checked={showCheckpoints} onChange={(e) => setShowCheckpoints(e.target.checked)} />
          <span>Checkpoints</span>
        </label>
        <button
          type="button"
          className="btn btn-o btn-sm"
          onClick={() => setTall((v) => !v)}
          aria-pressed={tall}
          title={tall ? 'Back to the compact map' : 'A taller map for a busy board'}
        >
          {tall ? 'Shrink map' : 'Expand map'}
        </button>
      </div>

      <div className="card porg-map-card">
        {allPoints.length === 0 ? (
          <div className="pempty">
            <span className="pempty-icon">◎</span>
            <strong>No positions to draw yet.</strong>
            <p>These runs are still loading at the shed — they appear below, and their markers arrive with the first position report after they set off.</p>
          </div>
        ) : (
          <MapContainer center={center} zoom={7} style={{ height: tall ? 'min(720px, 82dvh)' : 'min(440px, 62dvh)', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds points={allPoints} fitKey={`${selectedId ?? 'all'}:${runs.map((r) => r.id).join(',')}`} locked={locked} />
            <FocusRunner runs={runs} focus={focus} locked={locked} />
            <LockControl locked={locked} />
            <SizeFix tall={tall} />
            {runs.map((r) => {
              const leg: [number, number][] = [];
              if (r.origin) leg.push([r.origin.lat, r.origin.lng]);
              if (r.destination) leg.push([r.destination.lat, r.destination.lng]);
              const trail = Array.isArray(r.trail) ? r.trail : [];
              const segments = showTrails ? trailSegments(trail) : [];
              const stops = showTrails ? recordedStops(trail) : [];
              const dimmed = selectedId !== null && r.id !== selectedId;
              return (
                <span key={`leg-${r.id}`}>
                  {/* The whole planned journey, origin → destination, in blue. */}
                  {leg.length === 2 && (
                    <Polyline
                      positions={leg}
                      pathOptions={{ color: '#1565C0', weight: 4, opacity: dimmed ? 0.3 : 0.85 }}
                    />
                  )}
                  {/* Where the run actually went — coloured by measured
                      speed per segment: green flowing, amber slow, red
                      crawling. Grey where two reports share a timestamp. */}
                  {segments.map((s, i) => (
                    <Polyline
                      key={`seg-${r.id}-${i}`}
                      positions={[[s.from.lat, s.from.lng], [s.to.lat, s.to.lng]]}
                      pathOptions={{ color: speedColor(s.kmh), weight: 4, opacity: dimmed ? 0.25 : 0.9 }}
                    />
                  ))}
                  {stops.map((s, i) => (
                    <Marker key={`stop-${r.id}-${i}`} position={[s.lat, s.lng]} icon={STOP_ICON}>
                      <Popup>
                        <strong>{r.vehiclePlate} stop</strong><br />
                        <span className="sub">Stood ~{s.mins} min here</span>
                      </Popup>
                    </Marker>
                  ))}
                  {r.origin && (
                    <Marker position={[r.origin.lat, r.origin.lng]} icon={ORIGIN_ICON}>
                      <Popup>
                        <strong>{r.origin.name}</strong><br />
                        {r.origin.locationHint}<br />
                        <span className="sub">Start of {r.vehiclePlate}</span>
                      </Popup>
                    </Marker>
                  )}
                  {r.destination && (
                    <Marker position={[r.destination.lat, r.destination.lng]} icon={DESTINATION_ICON}>
                      <Popup>
                        <strong>{r.destination.name}</strong><br />
                        {r.destination.locationHint}<br />
                        <span className="sub">Destination of {r.vehiclePlate}</span>
                      </Popup>
                    </Marker>
                  )}
                </span>
              );
            })}
            {showCheckpoints && CHECKPOINTS.map((c) => (
              <Marker key={`cp-${c.name}`} position={[c.lat, c.lng]} icon={CHECKPOINT_ICON}>
                <Popup>
                  <strong>{c.name}</strong><br />
                  <span className="sub">{c.corridor} · known checkpoint — plan stops and papers</span>
                </Popup>
              </Marker>
            ))}
            {positioned.map((r) => {
              const crew = Array.isArray(r.crew) ? r.crew : [];
              const driver = crew.find((c) => c.role === 'DRIVER') ?? crew[0];
              if (r.currentLat === null || r.currentLng === null) return null;
              return (
                <Marker
                  key={`fleet-${r.id}`}
                  position={[r.currentLat, r.currentLng]}
                  icon={plateIcon(r.vehiclePlate, r.id === selectedId, lastSeenTone(r.currentAt))}
                  eventHandlers={{ click: () => onSelect(r.id) }}
                >
                  <Popup>
                    <strong className="mono">{r.vehiclePlate}</strong>
                    <span className="sub"> · {(r.vehicleType ?? '').toLowerCase()}</span><br />
                    {driver && <>{driver.name} ({(driver.roleLabel ?? driver.role ?? '').toLowerCase()})<br /></>}
                    {driver?.msisdn && <><DemoPhoneSpan msisdn={driver.msisdn} /><br /></>}
                    {r.origin && r.destination && (
                      <>{r.origin.name} → {r.destination.name}<br /></>
                    )}
                    <span className="sub">{lastSeenLabel(r.currentAt)}</span>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        )}
        <div className="sub porg-map-legend">
          <span><i className="porg-legend-line" style={{ background: '#2E7D32' }} />Flowing 35+</span>
          <span><i className="porg-legend-line" style={{ background: '#EF6C00' }} />Slow 12–35</span>
          <span><i className="porg-legend-line" style={{ background: '#C62828' }} />Crawling under 12 km/h</span>
          <span><i className="porg-legend-dot" />Marker dot = fix freshness</span>
          <span><i className="porg-legend-dot" style={{ background: '#4A148C' }}>!</i>Known checkpoint</span>
        </div>
      </div>
      </>)}

      {/* Runs with no position yet still belong to this section: a
          loading run has no GPS by definition, and hiding it here
          would read as "the map lost a vehicle". Collapsing hides the
          map tiles, never this list. */}
      {withoutGps.length > 0 && (
        <ul className="plist porg-map-nogps">
          {withoutGps.map((r) => (
            <li key={`nogps-${r.id}`} className={r.id === selectedId ? 'is-selected' : undefined}>
              <div className="plist-main">
                <span className="plist-title">
                  <span className="mono">{r.vehiclePlate}</span>
                  <span className="pill p-warn">{runStatusLabel(r.status)}</span>
                </span>
                <span className="plist-sub">
                  {r.origin?.name ?? '—'} → {r.destination?.name ?? '—'}
                  {' · '}no position yet — still loading at the shed
                </span>
              </div>
              <div className="plist-actions">
                <button type="button" className="btn btn-o btn-sm" onClick={() => onSelect(r.id)}>
                  Inspect
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
