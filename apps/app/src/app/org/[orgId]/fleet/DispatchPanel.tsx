'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import type { CrewMember, FleetTrip, FleetVehicle, ShortRoute } from '@/lib/fleet';
import { actionCloseTrip, actionStartTrip } from './actions';

const inputStyle: React.CSSProperties = {
  padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, width: '100%',
};

function timeOnly(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Live dispatch — who is on the road right now, and (for a role that
 * holds trip.write) a one-row form to put another vehicle out. Reads are
 * trip.read, the start/close writes are trip.write; the server enforces
 * both, so a MANAGER sees the board but only an ADMIN gets the actions.
 */
export function DispatchPanel({
  orgId, activeTrips, recentTrips, vehicles, crew, routes, canDispatch,
}: {
  orgId: string;
  activeTrips: FleetTrip[];
  recentTrips: FleetTrip[];
  vehicles: FleetVehicle[];
  crew: CrewMember[];
  routes: ShortRoute[];
  canDispatch: boolean;
}) {
  const [vehicleId, setVehicleId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [conductorId, setConductorId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const activeVehicles = vehicles.filter((v) => v.Status === 'ACTIVE');
  const activeCrew = crew.filter((c) => c.Active);
  const drivers = activeCrew.filter((c) => c.Role === 'DRIVER');
  const conductors = activeCrew.filter((c) => c.Role === 'CONDUCTOR');

  function start() {
    setError(null);
    if (!vehicleId) { setError('Pick a vehicle'); return; }
    startTransition(async () => {
      const result = await actionStartTrip(orgId, {
        vehicleId, shortRouteId: routeId || null,
        driverId: driverId || null, conductorId: conductorId || null,
      });
      if (!result.ok) { setError(result.error); return; }
      setVehicleId(''); setRouteId(''); setDriverId(''); setConductorId('');
    });
  }

  function close(tripId: string) {
    setError(null);
    startTransition(async () => {
      const result = await actionCloseTrip(orgId, tripId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <section className="mcard" style={{ marginBottom: 16 }}>
      <h2><Icon name="truck" size={18} />Live dispatch</h2>

      {canDispatch && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end', marginBottom: 14 }}>
          <label className="sub">Vehicle
            <select style={inputStyle} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Pick a bus…</option>
              {activeVehicles.map((v) => <option key={v.ID} value={v.ID}>{v.PlateNo}{v.Label ? ` · ${v.Label}` : ''}</option>)}
            </select>
          </label>
          <label className="sub">Route
            <select style={inputStyle} value={routeId} onChange={(e) => setRouteId(e.target.value)}>
              <option value="">No route</option>
              {routes.map((r) => <option key={r.ID} value={r.ID}>{r.Name}</option>)}
            </select>
          </label>
          <label className="sub">Driver
            <select style={inputStyle} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">Unassigned</option>
              {drivers.map((c) => <option key={c.ID} value={c.ID}>{c.Name}</option>)}
            </select>
          </label>
          <label className="sub">Conductor
            <select style={inputStyle} value={conductorId} onChange={(e) => setConductorId(e.target.value)}>
              <option value="">Unassigned</option>
              {conductors.map((c) => <option key={c.ID} value={c.ID}>{c.Name}</option>)}
            </select>
          </label>
          <button className="btn btn-p btn-sm" disabled={pending || !vehicleId} onClick={start}>
            {pending ? 'Starting…' : 'Put on the road'}
          </button>
        </div>
      )}

      {error && <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', margin: '0 0 10px' }}>{error}</p>}

      {activeTrips.length === 0 ? (
        <p className="sub" style={{ margin: 0 }}>No vehicles on the road right now.</p>
      ) : (
        <ul className="papers" style={{ marginBottom: recentTrips.length ? 16 : 0 }}>
          {activeTrips.map((t) => (
            <li className="paper" key={t.ID}>
              <span className="ps ok" aria-hidden="true"><Icon name="truck" size={16} /></span>
              <span className="pt">
                <span className="t">{t.VehiclePlate}</span>
                <span className="s">
                  Driver {t.DriverName ?? '—'} · Conductor {t.ConductorName ?? '—'} · out since {timeOnly(t.StartedAt)}
                </span>
              </span>
              {canDispatch && (
                <button className="btn btn-o btn-sm" disabled={pending} onClick={() => close(t.ID)}>Close</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {recentTrips.length > 0 && (
        <>
          <h3 style={{ fontSize: '.85rem', fontWeight: 700, margin: '0 0 6px', color: 'var(--tx-2)' }}>Closed today</h3>
          <ul className="papers">
            {recentTrips.slice(0, 8).map((t) => (
              <li className="paper" key={t.ID}>
                <span className="ps gap" aria-hidden="true"><Icon name="check" size={16} /></span>
                <span className="pt">
                  <span className="t">{t.VehiclePlate}</span>
                  <span className="s">
                    Driver {t.DriverName ?? '—'} · {timeOnly(t.StartedAt)}–{t.EndedAt ? timeOnly(t.EndedAt) : '—'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
