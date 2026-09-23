'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';

// Same divIcon-dot approach the admin live map and the fleet map use —
// Leaflet's default marker image breaks under Next's bundler.
const PIN = L.divIcon({
  className: '',
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#1565C0;border:2px solid white;box-shadow:0 0 3px rgba(0,0,0,.5)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

export function StationMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <MapContainer center={[lat, lng]} zoom={15} style={{ height: 300, width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[lat, lng]} icon={PIN}>
          <Popup>{label}</Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}
