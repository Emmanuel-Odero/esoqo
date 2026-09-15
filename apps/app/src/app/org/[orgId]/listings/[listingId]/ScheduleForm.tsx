'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionCreateSchedule } from '../actions';

export function ScheduleForm({ orgId, listingId, vertical }: { orgId: string; listingId: string; vertical: 'EVENTS' | 'TRANSPORT' }) {
  const [departAt, setDepartAt] = useState('');
  const [gateInfo, setGateInfo] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionCreateSchedule(orgId, listingId, {
        departAt, gateInfo: gateInfo || undefined, vehicleOrHallLabel: label || undefined,
      });
      if (r.ok) {
        setDepartAt(''); setGateInfo(''); setLabel('');
        announce('Occurrence scheduled.', 'polite');
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <div className="mcard" style={{ marginBottom: 16 }}>
      <h2><Icon name="clock" size={18} />Schedule {vertical === 'TRANSPORT' ? 'a departure' : 'a showtime'}</h2>
      <div className="fld">
        <label className="lab" htmlFor="sc-at">{vertical === 'TRANSPORT' ? 'Departs' : 'Starts'}</label>
        <input className="inp" id="sc-at" type="datetime-local" value={departAt} onChange={(e) => setDepartAt(e.target.value)} />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="sc-gate">{vertical === 'TRANSPORT' ? 'Boarding point' : 'Gate'} <span className="op">(optional)</span></label>
        <input className="inp" id="sc-gate" value={gateInfo} onChange={(e) => setGateInfo(e.target.value)} />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="sc-label">{vertical === 'TRANSPORT' ? 'Vehicle (plate/name)' : 'Hall/room'} <span className="op">(optional)</span></label>
        <input className="inp" id="sc-label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      <button type="button" className="btn btn-p" disabled={pending || !departAt} onClick={submit}>
        {pending ? 'Scheduling…' : 'Schedule'}
      </button>
    </div>
  );
}
