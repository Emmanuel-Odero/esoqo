'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionCreateTicketClass, actionCreateSchedule } from '../../../actions';

interface TicketClassRow { id: string; name: string; priceKes: number; capacity: number; seated: boolean }
interface ScheduleRow {
  id: string; departAt: string; arriveAt: string | null;
  gateInfo: string | null; vehicleOrHallLabel: string | null; status: string; bookingCount: number;
}

const SCHEDULE_STATUS_PILL: Record<string, string> = { SCHEDULED: 'p-ok', CANCELLED: 'p-bad', COMPLETED: '' };

export function ListingDetailPanel({
  orgId, listingId, ticketClasses, schedules,
}: { orgId: string; listingId: string; ticketClasses: TicketClassRow[]; schedules: ScheduleRow[] }) {
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  const [tcName, setTcName] = useState('');
  const [tcPrice, setTcPrice] = useState('');
  const [tcCapacity, setTcCapacity] = useState('');
  const [tcSeated, setTcSeated] = useState(false);
  const [tcError, setTcError] = useState<string | null>(null);

  const [depart, setDepart] = useState('');
  const [arrive, setArrive] = useState('');
  const [gateInfo, setGateInfo] = useState('');
  const [vehicleLabel, setVehicleLabel] = useState('');
  const [schedError, setSchedError] = useState<string | null>(null);

  function submitTicketClass() {
    setTcError(null);
    const priceKes = Number(tcPrice);
    const capacity = Number(tcCapacity);
    if (!tcName.trim() || !Number.isFinite(priceKes) || priceKes < 0 || !Number.isInteger(capacity) || capacity < 1) {
      setTcError('Give the class a name, a price of 0 or more, and a capacity of at least 1.');
      return;
    }
    start(async () => {
      const r = await actionCreateTicketClass(orgId, listingId, { name: tcName, priceKes, capacity, seated: tcSeated });
      if (r.ok) {
        setTcName(''); setTcPrice(''); setTcCapacity(''); setTcSeated(false);
        announce('Ticket class added.', 'polite');
      } else { setTcError(r.error); announce(r.error, 'assertive'); }
    });
  }

  function submitSchedule() {
    setSchedError(null);
    if (!depart) { setSchedError('Give the occurrence a departure/start date and time.'); return; }
    start(async () => {
      const r = await actionCreateSchedule(orgId, listingId, {
        departAt: depart, arriveAt: arrive || undefined, gateInfo: gateInfo || undefined, vehicleOrHallLabel: vehicleLabel || undefined,
      });
      if (r.ok) {
        setDepart(''); setArrive(''); setGateInfo(''); setVehicleLabel('');
        announce('Occurrence scheduled.', 'polite');
      } else { setSchedError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2><Icon name="certificate" size={18} />Ticket classes</h2>
        <p style={{ color: 'var(--tx-2)', fontSize: '.9rem', margin: '0 0 14px' }}>
          Price tiers reused across every occurrence — Economy vs VIP, or a coach&rsquo;s seated
          classes. Seated classes get numbered seats generated per occurrence automatically.
        </p>
        <div className="fld">
          <label className="lab" htmlFor="tc-name">Name</label>
          <input className="inp" id="tc-name" value={tcName} onChange={(e) => setTcName(e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="tc-price">Price (KES)</label>
          <input className="inp" id="tc-price" type="number" min={0} value={tcPrice} onChange={(e) => setTcPrice(e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="tc-capacity">Capacity</label>
          <input className="inp" id="tc-capacity" type="number" min={1} value={tcCapacity} onChange={(e) => setTcCapacity(e.target.value)} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.88rem', margin: '10px 0' }}>
          <input type="checkbox" checked={tcSeated} onChange={(e) => setTcSeated(e.target.checked)} />
          Seated (numbered seats, not general admission)
        </label>
        {tcError && (
          <p className="pill p-bad" style={{ marginTop: 4, padding: '10px 13px', whiteSpace: 'normal' }} role="alert">
            <Icon name="alert-circle" size={14} />{tcError}
          </p>
        )}
        <button className="btn btn-p btn-sm" style={{ marginTop: 12 }} disabled={pending} onClick={submitTicketClass}>
          <Icon name="plus" size={14} />{pending ? 'Adding…' : 'Add ticket class'}
        </button>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        {ticketClasses.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="certificate" size={22} /></span>
            <h3>No ticket classes yet</h3>
          </div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Name</th><th className="num">Price</th><th className="num">Capacity</th><th>Seated</th></tr></thead>
            <tbody>
              {ticketClasses.map((tc) => (
                <tr key={tc.id}>
                  <td><strong>{tc.name}</strong></td>
                  <td className="num mono">KES {tc.priceKes.toLocaleString('en-KE')}</td>
                  <td className="num">{tc.capacity}</td>
                  <td>{tc.seated ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2><Icon name="clock" size={18} />Schedule an occurrence</h2>
        <p style={{ color: 'var(--tx-2)', fontSize: '.9rem', margin: '0 0 14px' }}>
          A showtime or departure. Seated ticket classes get their numbered seats generated for
          this specific occurrence.
        </p>
        <div className="fld">
          <label className="lab" htmlFor="s-depart">Departs / starts</label>
          <input className="inp" id="s-depart" type="datetime-local" value={depart} onChange={(e) => setDepart(e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="s-arrive">Arrives / ends (optional)</label>
          <input className="inp" id="s-arrive" type="datetime-local" value={arrive} onChange={(e) => setArrive(e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="s-gate">Gate / platform info</label>
          <input className="inp" id="s-gate" value={gateInfo} onChange={(e) => setGateInfo(e.target.value)} placeholder="e.g. Gate B, Platform 3" />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="s-vehicle">Vehicle / hall label</label>
          <input className="inp" id="s-vehicle" value={vehicleLabel} onChange={(e) => setVehicleLabel(e.target.value)} placeholder="e.g. KDA 123X" />
        </div>
        {schedError && (
          <p className="pill p-bad" style={{ marginTop: 4, padding: '10px 13px', whiteSpace: 'normal' }} role="alert">
            <Icon name="alert-circle" size={14} />{schedError}
          </p>
        )}
        <button className="btn btn-p btn-sm" style={{ marginTop: 12 }} disabled={pending || !depart} onClick={submitSchedule}>
          <Icon name="plus" size={14} />{pending ? 'Scheduling…' : 'Schedule occurrence'}
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {schedules.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="clock" size={22} /></span>
            <h3>No occurrences yet</h3>
          </div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Departs</th><th>Vehicle / hall</th><th>Gate info</th><th className="num">Bookings</th><th>Status</th></tr></thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.departAt).toLocaleString('en-KE')}</td>
                  <td>{s.vehicleOrHallLabel || '—'}</td>
                  <td>{s.gateInfo || '—'}</td>
                  <td className="num">{s.bookingCount}</td>
                  <td><span className={`pill ${SCHEDULE_STATUS_PILL[s.status] ?? ''}`}>{s.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
