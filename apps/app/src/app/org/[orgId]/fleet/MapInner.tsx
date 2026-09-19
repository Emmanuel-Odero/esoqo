'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import type { ActiveTrail, VehiclePosition } from '@/lib/fleet';

// Plain divIcon circles instead of Leaflet's default marker image — the
// marker's bundled image URLs break under Next's bundler (the same
// well-known Leaflet-in-React issue the admin live map's own comment
// records), and a dot is all this needs.
function dotIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 2px rgba(0,0,0,.5)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

const LIVE_ICON = dotIcon('#2E7D32');
// A vehicle that stopped reporting in the last 15 minutes — still shown,
// but not pretending to be live (see FleetOverview.reportingVehicles).
const STALE_ICON = dotIcon('#F9A825');

// Nairobi CBD — only used when nothing has pinged yet.
const DEFAULT_CENTER: [number, number] = [-1.2864, 36.8172];

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export function MapInner({
  positions, trails,
}: { positions: VehiclePosition[]; trails: ActiveTrail[] }) {
  const points: [number, number][] = positions.map((p) => [Number(p.Lat), Number(p.Lng)]);
  const center: [number, number] = points.length
    ? [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length]
    : DEFAULT_CENTER;

  return (
    <div className="mcard" style={{ padding: 0, overflow: 'hidden' }}>
      <MapContainer center={center} zoom={12} style={{ height: 'min(430px, 62dvh)', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {trails.map((t) => {
          const line = t.points
            .map((p) => [Number(p.lat), Number(p.lng)] as [number, number])
            .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
          if (line.length < 2) return null;
          return (
            <Polyline
              key={`trail-${t.tripId}`}
              positions={line}
              pathOptions={{ color: '#1565C0', weight: 3, opacity: 0.65 }}
            />
          );
        })}
        {positions.map((p) => {
          const mins = minutesAgo(p.At);
          return (
            <Marker
              key={`${p.VehicleID}-${p.TripID}`}
              position={[Number(p.Lat), Number(p.Lng)]}
              icon={mins <= 15 ? LIVE_ICON : STALE_ICON}
            >
              <Popup>
                <strong>{p.VehiclePlate}</strong><br />
                Last seen {mins}m ago
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
