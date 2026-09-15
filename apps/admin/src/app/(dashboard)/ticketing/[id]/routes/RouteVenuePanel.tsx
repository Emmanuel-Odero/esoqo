'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionCreateVenue, actionCreateRoute } from '../../actions';

interface VenueRow { id: string; name: string; address: string | null; county: string | null; capacity: number | null }
interface RouteRow { id: string; originName: string; destinationName: string; distanceKm: number | null }

export function RouteVenuePanel({
  orgId, vertical, venues, routes,
}: { orgId: string; vertical: string; venues: VenueRow[]; routes: RouteRow[] }) {
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  const [vName, setVName] = useState('');
  const [vAddress, setVAddress] = useState('');
  const [vCounty, setVCounty] = useState('');
  const [vCapacity, setVCapacity] = useState('');
  const [vError, setVError] = useState<string | null>(null);

  const [rOrigin, setROrigin] = useState('');
  const [rDest, setRDest] = useState('');
  const [rDistance, setRDistance] = useState('');
  const [rError, setRError] = useState<string | null>(null);

  function submitVenue() {
    setVError(null);
    start(async () => {
      const r = await actionCreateVenue(orgId, {
        name: vName, address: vAddress || undefined, county: vCounty || undefined,
        capacity: vCapacity ? Number(vCapacity) : undefined,
      });
      if (r.ok) {
        setVName(''); setVAddress(''); setVCounty(''); setVCapacity('');
        announce('Venue added.', 'polite');
      } else { setVError(r.error); announce(r.error, 'assertive'); }
    });
  }

  function submitRoute() {
    setRError(null);
    start(async () => {
      const r = await actionCreateRoute(orgId, {
        originName: rOrigin, destinationName: rDest, distanceKm: rDistance ? Number(rDistance) : undefined,
      });
      if (r.ok) {
        setROrigin(''); setRDest(''); setRDistance('');
        announce('Route added.', 'polite');
      } else { setRError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2><Icon name="building" size={18} />Venues</h2>
        <p style={{ color: 'var(--tx-2)', fontSize: '.9rem', margin: '0 0 14px' }}>
          Halls, grounds or terminals a listing can be held at. Every event or tour listing picks one
          of these.
        </p>
        <div className="fld">
          <label className="lab" htmlFor="v-name">Name</label>
          <input className="inp" id="v-name" value={vName} onChange={(e) => setVName(e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="v-address">Address</label>
          <input className="inp" id="v-address" value={vAddress} onChange={(e) => setVAddress(e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="v-county">County</label>
          <input className="inp" id="v-county" value={vCounty} onChange={(e) => setVCounty(e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="v-capacity">Capacity</label>
          <input className="inp" id="v-capacity" type="number" min={1} value={vCapacity} onChange={(e) => setVCapacity(e.target.value)} />
        </div>
        {vError && (
          <p className="pill p-bad" style={{ marginTop: 10, padding: '10px 13px', whiteSpace: 'normal' }} role="alert">
            <Icon name="alert-circle" size={14} />{vError}
          </p>
        )}
        <button className="btn btn-p btn-sm" style={{ marginTop: 12 }} disabled={pending || !vName.trim()} onClick={submitVenue}>
          <Icon name="plus" size={14} />{pending ? 'Adding…' : 'Add venue'}
        </button>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        {venues.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="building" size={22} /></span>
            <h3>No venues yet</h3>
          </div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Name</th><th>Address</th><th>County</th><th className="num">Capacity</th></tr></thead>
            <tbody>
              {venues.map((v) => (
                <tr key={v.id}>
                  <td><strong>{v.name}</strong></td>
                  <td>{v.address || '—'}</td>
                  <td>{v.county || '—'}</td>
                  <td className="num">{v.capacity ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {vertical === 'TRANSPORT' && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2><Icon name="truck" size={18} />Routes</h2>
            <p style={{ color: 'var(--tx-2)', fontSize: '.9rem', margin: '0 0 14px' }}>
              Origin → destination pairs this operator runs. A trip listing picks one; departures
              are scheduled against it as occurrences.
            </p>
            <div className="fld">
              <label className="lab" htmlFor="r-origin">Origin</label>
              <input className="inp" id="r-origin" value={rOrigin} onChange={(e) => setROrigin(e.target.value)} />
            </div>
            <div className="fld">
              <label className="lab" htmlFor="r-dest">Destination</label>
              <input className="inp" id="r-dest" value={rDest} onChange={(e) => setRDest(e.target.value)} />
            </div>
            <div className="fld">
              <label className="lab" htmlFor="r-distance">Distance (km)</label>
              <input className="inp" id="r-distance" type="number" min={1} value={rDistance} onChange={(e) => setRDistance(e.target.value)} />
            </div>
            {rError && (
              <p className="pill p-bad" style={{ marginTop: 10, padding: '10px 13px', whiteSpace: 'normal' }} role="alert">
                <Icon name="alert-circle" size={14} />{rError}
              </p>
            )}
            <button className="btn btn-p btn-sm" style={{ marginTop: 12 }} disabled={pending || !rOrigin.trim() || !rDest.trim()} onClick={submitRoute}>
              <Icon name="plus" size={14} />{pending ? 'Adding…' : 'Add route'}
            </button>
          </div>

          <div className="card" style={{ padding: 0 }}>
            {routes.length === 0 ? (
              <div className="empty">
                <span className="ico"><Icon name="truck" size={22} /></span>
                <h3>No routes yet</h3>
              </div>
            ) : (
              <table className="tbl">
                <thead><tr><th>Origin</th><th>Destination</th><th className="num">Distance</th></tr></thead>
                <tbody>
                  {routes.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.originName}</strong></td>
                      <td>{r.destinationName}</td>
                      <td className="num">{r.distanceKm ? `${r.distanceKm} km` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
