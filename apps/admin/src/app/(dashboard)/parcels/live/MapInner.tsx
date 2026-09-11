'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import type { LiveCourierPosition, LiveUnassignedParcel } from '../actions';

// Plain divIcon circles instead of Leaflet's default marker image — the
// default marker's image URLs break under Next.js/webpack bundling
// (a well-known Leaflet-in-React issue with no clean fix short of
// manually re-pointing every icon path), and a colored dot is all this
// map needs to distinguish a courier from a parcel anyway.
function dotIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 2px rgba(0,0,0,.5)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

const COURIER_ICON = dotIcon('#2E7D32');
const PARCEL_ICON = dotIcon('#607D8B');
const OVERDUE_ICON = dotIcon('#C62828');

// Nairobi CBD — used only when there's nothing to center on yet (no
// courier pings, no zoned parcels).
const DEFAULT_CENTER: [number, number] = [-1.2864, 36.8172];

function minutesAgo(iso: string) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

export function MapInner({
  couriers, parcels,
}: { couriers: LiveCourierPosition[]; parcels: LiveUnassignedParcel[] }) {
  const points: [number, number][] = [
    ...couriers.map((c) => [Number(c.Lat), Number(c.Lng)] as [number, number]),
    ...parcels.filter((p) => p.Lat && p.Lng).map((p) => [Number(p.Lat), Number(p.Lng)] as [number, number]),
  ];
  const center = points.length > 0
    ? [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length] as [number, number]
    : DEFAULT_CENTER;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <MapContainer center={center} zoom={12} style={{ height: 520, width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {couriers.map((c) => (
          <Marker key={c.CourierPartyID} position={[Number(c.Lat), Number(c.Lng)]} icon={COURIER_ICON}>
            <Popup>
              <strong>{c.Name}</strong><br />
              {c.VehicleType.replace(/_/g, ' ')}<br />
              Last seen {minutesAgo(c.At)}m ago
            </Popup>
          </Marker>
        ))}
        {parcels.filter((p) => p.Lat && p.Lng).map((p) => (
          <Marker key={p.Code} position={[Number(p.Lat), Number(p.Lng)]} icon={p.Overdue ? OVERDUE_ICON : PARCEL_ICON}>
            <Popup>
              <strong>{p.Code}</strong><br />
              {p.Status.replace(/_/g, ' ')}{p.Overdue && ' — past SLA'}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
