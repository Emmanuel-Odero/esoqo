'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import type { DispatchRun } from '@/lib/parcel-org-session';
import { DemoPhoneSpan } from '@/components/DemoContact';
import { lastSeenLabel, recordedStops, speedColor, trailSegments } from './dispatch-stats';

// The fleet marker: the vehicle's number plate as the label, so the
// board reads at a glance which bus is where. A divIcon again (never
// the stock marker image — same Leaflet-in-Next bundling reason the
// other maps document).
function plateIcon(plate: string, selected: boolean) {
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;gap:6px;transform:translate(-50%,-50%);white-space:nowrap;">` +
      `<div style="width:14px;height:14px;border-radius:50%;background:${selected ? '#0D47A1' : '#1565C0'};` +
      `border:2px solid white;box-shadow:0 0 3px rgba(0,0,0,.55)"></div>` +
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
 *  somebody is inspecting a run. */
function FitBounds({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng))), { padding: [36, 36] });
  }, [map, fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function FleetDispatchMapInner({
  runs, selectedId, onSelect,
}: {
  runs: DispatchRun[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const active = runs.filter((r) => r.status === 'ACTIVE');
  const shown = active.length > 0 ? active : runs;

  const allPoints: [number, number][] = [];
  for (const r of shown) {
    if (r.origin) allPoints.push([r.origin.lat, r.origin.lng]);
    if (r.destination) allPoints.push([r.destination.lat, r.destination.lng]);
    if (r.currentLat !== null && r.currentLng !== null) allPoints.push([r.currentLat, r.currentLng]);
    for (const p of r.trail) allPoints.push([p.lat, p.lng]);
  }
  const center: [number, number] = allPoints.length
    ? [allPoints.reduce((s, p) => s + p[0], 0) / allPoints.length, allPoints.reduce((s, p) => s + p[1], 0) / allPoints.length]
    : DEFAULT_CENTER;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <MapContainer center={center} zoom={allPoints.length ? 7 : 12} style={{ height: 'min(440px, 62dvh)', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={allPoints} fitKey={`${selectedId ?? 'all'}:${shown.map((r) => r.id).join(',')}`} />
        {shown.map((r) => {
          const leg: [number, number][] = [];
          if (r.origin) leg.push([r.origin.lat, r.origin.lng]);
          if (r.destination) leg.push([r.destination.lat, r.destination.lng]);
          const segments = trailSegments(r.trail);
          const stops = recordedStops(r.trail);
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
        {CHECKPOINTS.map((c) => (
          <Marker key={`cp-${c.name}`} position={[c.lat, c.lng]} icon={CHECKPOINT_ICON}>
            <Popup>
              <strong>{c.name}</strong><br />
              <span className="sub">{c.corridor} · known checkpoint — plan stops and papers</span>
            </Popup>
          </Marker>
        ))}
        {shown.map((r) => {
          if (r.currentLat === null || r.currentLng === null) return null;
          const driver = r.crew.find((c) => c.role === 'DRIVER') ?? r.crew[0];
          return (
            <Marker
              key={`fleet-${r.id}`}
              position={[r.currentLat, r.currentLng]}
              icon={plateIcon(r.vehiclePlate, r.id === selectedId)}
              eventHandlers={{ click: () => onSelect(r.id) }}
            >
              <Popup>
                <strong className="mono">{r.vehiclePlate}</strong>
                <span className="sub"> · {r.vehicleType.toLowerCase()}</span><br />
                {driver && <>{driver.name} ({driver.roleLabel.toLowerCase()})<br /></>}
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
      <div className="sub" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '10px 14px', borderTop: '1px solid var(--line)' }}>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ width: 22, height: 4, borderRadius: 2, background: '#2E7D32', display: 'inline-block' }} />Flowing 35+
        </span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ width: 22, height: 4, borderRadius: 2, background: '#EF6C00', display: 'inline-block' }} />Slow 12–35
        </span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ width: 22, height: 4, borderRadius: 2, background: '#C62828', display: 'inline-block' }} />Crawling under 12 km/h
        </span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#4A148C', color: '#fff', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>!</span>
          Known checkpoint
        </span>
      </div>
    </div>
  );
}
