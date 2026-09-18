'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import type { OrgLiveParcel, OrgLiveRider, ParcelOrgStationRow } from '@/lib/parcel-org-session';

// Dots, not the stock marker image — the same Leaflet-in-Next bundling
// reason the admin live map and the fleet map already document.
function dotIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 2px rgba(0,0,0,.5)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

const RIDER_ICON = dotIcon('#2E7D32');
const PARCEL_ICON = dotIcon('#F9A825');
const OVERDUE_ICON = dotIcon('#C62828');
const STATION_ICON = dotIcon('#1565C0');

// Nairobi CBD — only when nothing has a position yet.
const DEFAULT_CENTER: [number, number] = [-1.2864, 36.8172];

function minutesAgo(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return -1;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
}

export function DispatchMapInner({
  riders, parcels, stations,
}: {
  riders: OrgLiveRider[];
  parcels: OrgLiveParcel[];
  stations: ParcelOrgStationRow[];
}) {
  const points: [number, number][] = [
    ...riders.map((r) => [Number(r.lat), Number(r.lng)] as [number, number]),
    ...parcels.filter((p) => p.lat && p.lng).map((p) => [Number(p.lat), Number(p.lng)] as [number, number]),
    ...stations.map((s) => [s.lat, s.lng] as [number, number]),
  ].filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  const center: [number, number] = points.length
    ? [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length]
    : DEFAULT_CENTER;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <MapContainer center={center} zoom={12} style={{ height: 420, width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {stations.map((s) => (
          <Marker key={`station-${s.id}`} position={[s.lat, s.lng]} icon={STATION_ICON}>
            <Popup>
              <strong>{s.name}</strong><br />
              {s.locationHint}{s.openingHours ? <><br />{s.openingHours}</> : null}
            </Popup>
          </Marker>
        ))}
        {riders.map((r) => {
          const mins = minutesAgo(r.at);
          return (
            <Marker key={`rider-${r.partyId}`} position={[Number(r.lat), Number(r.lng)]} icon={RIDER_ICON}>
              <Popup>
                <strong>{r.name}</strong><br />
                {r.role.toLowerCase()}
                {mins >= 0 && <><br />Last seen {mins}m ago</>}
              </Popup>
            </Marker>
          );
        })}
        {parcels.filter((p) => p.lat && p.lng).map((p) => (
          <Marker key={`parcel-${p.code}`} position={[Number(p.lat), Number(p.lng)]} icon={p.overdue ? OVERDUE_ICON : PARCEL_ICON}>
            <Popup>
              <strong className="mono">{p.code}</strong><br />
              {p.status.replace(/_/g, ' ').toLowerCase()} · {p.receiverName}
              {p.overdue && ' — past SLA'}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
