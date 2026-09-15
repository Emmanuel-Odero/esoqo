'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import type { CourierPositionView, ParcelAgentStopView } from './actions';

/**
 * The "where is it right now" half of the tracking page.
 *
 * Loaded only through next/dynamic with ssr:false (see TrackingMap) —
 * Leaflet touches `window` at import time, and this is a guest page on
 * a mobile connection, so the map bundle must not be part of the
 * initial payload for someone who only wanted a status line.
 */

// Plain divIcon circles instead of Leaflet's default marker image — the
// default marker's image URLs break under Next.js/webpack bundling (a
// well-known Leaflet-in-React issue), and a coloured dot is all this
// map needs. Same approach the admin dispatch map already takes.
function dotIcon(color: string, pulse = false) {
  return L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};
      border:3px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.2)${
        pulse ? ',0 0 0 8px ' + color + '33' : ''
      }"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

const COURIER_ICON = dotIcon('#2E7D32', true);
const AGENT_ICON = dotIcon('#1565C0');

export function TrackingMapInner({
  position, agent, destinationLabel,
}: {
  position: CourierPositionView | null;
  agent: ParcelAgentStopView | null;
  destinationLabel: string;
}) {
  const points: [number, number][] = [];
  if (position) points.push([position.lat, position.lng]);
  if (agent) points.push([agent.lat, agent.lng]);
  if (points.length === 0) return null;

  // Centre on the courier when there is one — the moving thing is what
  // the viewer opened this for. Falls back to the shop otherwise.
  const center = points[0]!;
  const bounds = points.length > 1 ? L.latLngBounds(points).pad(0.3) : undefined;

  return (
    <div style={{ height: 240, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)' }}>
      <MapContainer
        center={center}
        bounds={bounds}
        zoom={14}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
        attributionControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {position && (
          <Marker position={[position.lat, position.lng]} icon={COURIER_ICON}>
            <Popup>
              Your parcel, heading to {destinationLabel}
              {position.staleMins > 2 && <><br />Updated {position.staleMins} min ago</>}
            </Popup>
          </Marker>
        )}
        {agent && (
          <Marker position={[agent.lat, agent.lng]} icon={AGENT_ICON}>
            <Popup>{agent.name}<br />{agent.locationHint}</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
