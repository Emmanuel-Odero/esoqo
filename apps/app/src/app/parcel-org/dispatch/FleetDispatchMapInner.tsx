'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import type { DispatchRun } from '@/lib/parcel-org-session';

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

function minutesAgo(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
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
      <MapContainer center={center} zoom={allPoints.length ? 7 : 12} style={{ height: 480, width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={allPoints} fitKey={`${selectedId ?? 'all'}:${shown.map((r) => r.id).join(',')}`} />
        {shown.map((r) => {
          const leg: [number, number][] = [];
          if (r.origin) leg.push([r.origin.lat, r.origin.lng]);
          if (r.destination) leg.push([r.destination.lat, r.destination.lng]);
          return (
            <span key={`leg-${r.id}`}>
              {/* The whole planned journey, origin → destination, in blue. */}
              {leg.length === 2 && (
                <Polyline
                  positions={leg}
                  pathOptions={{ color: '#1565C0', weight: 4, opacity: 0.85 }}
                />
              )}
              {/* Where the run actually went so far — solid darker trace. */}
              {r.trail.length >= 2 && (
                <Polyline
                  positions={r.trail.map((p) => [p.lat, p.lng] as [number, number])}
                  pathOptions={{ color: '#0D47A1', weight: 3, opacity: 0.7 }}
                />
              )}
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
        {shown.map((r) => {
          if (r.currentLat === null || r.currentLng === null) return null;
          const mins = minutesAgo(r.currentAt);
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
                {r.origin && r.destination && (
                  <>{r.origin.name} → {r.destination.name}<br /></>
                )}
                {mins !== null && <span className="sub">Seen {mins}m ago</span>}
                {mins === null && <span className="sub">No position yet</span>}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
