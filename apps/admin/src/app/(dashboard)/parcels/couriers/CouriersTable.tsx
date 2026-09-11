'use client';

import { Fragment, useEffect, useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import {
  actionOnboardCourier, actionSearchOnboardCandidates, actionSetCourierStatus, actionGetCourierPerformance,
  actionAddCourierTeamMember, type ParcelCourierRow, type CollectorLite, type CourierPerformance,
} from '../actions';

const VEHICLE_TYPES = ['BODA', 'BICYCLE', 'TUKTUK', 'VAN', 'TRUCK', 'ON_FOOT'];

export function CouriersTable({
  couriers, statusLabel, canManage,
}: { couriers: ParcelCourierRow[]; statusLabel: Record<string, string>; canManage: boolean }) {
  const [onboarding, setOnboarding] = useState(false);
  const [adding, setAdding] = useState(false);
  const [statusFor, setStatusFor] = useState<string | null>(null);
  const [perfFor, setPerfFor] = useState<string | null>(null);

  return (
    <div className="card" style={{ padding: 0 }}>
      {canManage && (
        <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-p btn-sm" onClick={() => { setOnboarding((v) => !v); setAdding(false); }}>
              {onboarding ? 'Close' : 'Onboard a courier'}
            </button>
            <button className="btn btn-o btn-sm" onClick={() => { setAdding((v) => !v); setOnboarding(false); }}>
              {adding ? 'Close' : 'Add courier team member'}
            </button>
          </div>
          {onboarding && <OnboardPanel onClose={() => setOnboarding(false)} />}
          {adding && <AddCourierPanel onClose={() => setAdding(false)} />}
        </div>
      )}
      <table className="tbl">
        <thead>
          <tr>
            <th>Name</th><th>Phone</th><th>Vehicle</th><th>Status</th><th>Note</th>{canManage && <th />}
          </tr>
        </thead>
        <tbody>
          {couriers.map((c) => (
            <Fragment key={c.ID}>
              <tr>
                <td>
                  <button onClick={() => setPerfFor(perfFor === c.PartyID ? null : c.PartyID)}
                    style={{ font: 'inherit', color: 'inherit', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline dotted' }}>
                    {c.Name}
                  </button>
                </td>
                <td className="mono sub">{c.Msisdn ?? '—'}</td>
                <td className="sub">{c.VehicleType.replace(/_/g, ' ')}</td>
                <td>
                  <span className={`pill ${c.Status === 'ACTIVE' ? 'p-ok' : c.Status === 'SUSPENDED' || c.Status === 'REJECTED' ? 'p-bad' : 'p-warn'}`}>
                    {statusLabel[c.Status] ?? c.Status}
                  </span>
                </td>
                <td className="sub">{c.VettingNote ?? '—'}</td>
                {canManage && (
                  <td>
                    <button className="btn btn-o btn-sm" onClick={() => setStatusFor(statusFor === c.ID ? null : c.ID)}>
                      Change status
                    </button>
                  </td>
                )}
              </tr>
              {statusFor === c.ID && (
                <tr><td colSpan={canManage ? 6 : 5} style={{ padding: 0 }}>
                  <StatusPanel courier={c} onClose={() => setStatusFor(null)} />
                </td></tr>
              )}
              {perfFor === c.PartyID && (
                <tr><td colSpan={canManage ? 6 : 5} style={{ padding: 0 }}>
                  <PerformancePanel partyId={c.PartyID} onClose={() => setPerfFor(null)} />
                </td></tr>
              )}
            </Fragment>
          ))}
          {couriers.length === 0 && (
            <tr><td colSpan={canManage ? 6 : 5} className="sub" style={{ textAlign: 'center', padding: 24 }}>No couriers match that filter.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function OnboardPanel({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [candidates, setCandidates] = useState<CollectorLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CollectorLite | null>(null);
  const [vehicleType, setVehicleType] = useState('BODA');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function search() {
    if (!q.trim()) return;
    setSearching(true);
    try {
      setCandidates(await actionSearchOnboardCandidates(q));
    } finally {
      setSearching(false);
    }
  }

  function submit() {
    if (!selected) {
      setError('Search for and pick a person first');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await actionOnboardCourier(selected.PartyID, vehicleType);
      if (!result.ok) setError(result.error);
      else onClose();
    });
  }

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input placeholder="Search by name or phone" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          style={{ flex: 1, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
        <button className="btn btn-o btn-sm" onClick={search} disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
      </div>
      {candidates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {candidates.map((c) => (
            <button key={c.PartyID} className="btn btn-o btn-sm"
              style={{ justifyContent: 'flex-start', background: selected?.PartyID === c.PartyID ? 'var(--blue-t)' : undefined }}
              onClick={() => setSelected(c)}>
              {c.Name} {c.Msisdn ? `— ${c.Msisdn}` : ''}
            </button>
          ))}
        </div>
      )}
      <label className="sub">Vehicle
        <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}
          style={{ display: 'block', padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }}>
          {VEHICLE_TYPES.map((v) => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-p btn-sm" onClick={submit} disabled={pending}>{pending ? 'Onboarding…' : 'Onboard'}</button>
      </div>
      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
    </div>
  );
}

const FIELD: React.CSSProperties = { display: 'block', padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 2 };

// The "just add them" path — a real courier team member who's never
// touched the Esoko app, entered straight from name/phone/vehicle
// instead of searching for an existing account (see OnboardPanel
// above, which stays the right tool for someone already in the
// system). core-go texts them their Esoko ID the moment this succeeds
// — see actionAddCourierTeamMember's own comment — so a wrong number
// here shows up as "they never got the text", not silently.
function AddCourierPanel({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [msisdn, setMsisdn] = useState('');
  const [email, setEmail] = useState('');
  const [vehicleType, setVehicleType] = useState('BODA');
  const [error, setError] = useState<string | null>(null);
  const [savedEsokoId, setSavedEsokoId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!name.trim() || !msisdn.trim()) {
      setError('Name and phone number are both required.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await actionAddCourierTeamMember({
        name: name.trim(), msisdn: msisdn.trim(), email: email.trim() || undefined, vehicleType,
      });
      if (!result.ok) { setError(result.error); return; }
      setSavedEsokoId(result.esokoId);
    });
  }

  if (savedEsokoId) {
    return (
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ margin: 0 }}>
          <Icon name="check-circle" size={15} /> Added — Esoko ID <strong className="mono">{savedEsokoId}</strong>,
          texted to {msisdn} for confirmation.
        </p>
        <div><button className="btn btn-o btn-sm" onClick={onClose}>Close</button></div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
      <label className="sub">Name of team member
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...FIELD, width: '100%' }} />
      </label>
      <div style={{ display: 'flex', gap: 10 }}>
        <label className="sub" style={{ flex: 1 }}>Phone number
          <input value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="+2547XXXXXXXX"
            style={{ ...FIELD, width: '100%' }} />
        </label>
        <label className="sub" style={{ flex: 1 }}>Contact (email, optional)
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...FIELD, width: '100%' }} />
        </label>
      </div>
      <label className="sub">Vehicle
        <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} style={FIELD}>
          {VEHICLE_TYPES.map((v) => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
        </select>
      </label>
      <p className="sub" style={{ margin: 0 }}>
        They&apos;ll be texted a confirmation with their Esoko ID — that same text is how you&apos;ll know
        the phone number is right.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-p btn-sm" onClick={submit} disabled={pending}>{pending ? 'Adding…' : 'Add & send confirmation'}</button>
      </div>
      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
    </div>
  );
}

function StatusPanel({ courier, onClose }: { courier: ParcelCourierRow; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setStatus(status: string) {
    setError(null);
    startTransition(async () => {
      const result = await actionSetCourierStatus(courier.ID, status, note.trim() || undefined);
      if (!result.ok) setError(result.error);
      else onClose();
    });
  }

  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <strong>Change status — {courier.Name}</strong>
      <label className="sub">Note (goes on record, optional)
        <input value={note} onChange={(e) => setNote(e.target.value)}
          style={{ display: 'block', width: '100%', padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {courier.Status !== 'ACTIVE' && (
          <button className="btn btn-p btn-sm" onClick={() => setStatus('ACTIVE')} disabled={pending}>Activate</button>
        )}
        {courier.Status === 'ACTIVE' && (
          <button className="btn btn-o btn-sm" style={{ color: 'var(--amber)' }} onClick={() => setStatus('SUSPENDED')} disabled={pending}>Suspend</button>
        )}
        {courier.Status === 'SUSPENDED' && (
          <button className="btn btn-o btn-sm" onClick={() => setStatus('ACTIVE')} disabled={pending}>Reinstate</button>
        )}
        {courier.Status !== 'REJECTED' && (
          <button className="btn btn-o btn-sm" style={{ color: 'var(--red)' }} onClick={() => setStatus('REJECTED')} disabled={pending}>Reject</button>
        )}
        <button className="btn btn-o btn-sm" onClick={onClose}>Close</button>
      </div>
      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
    </div>
  );
}

function PerformancePanel({ partyId, onClose }: { partyId: string; onClose: () => void }) {
  const [perf, setPerf] = useState<CourierPerformance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    actionGetCourierPerformance(partyId).then((p) => { if (!cancelled) { setPerf(p); setLoading(false); } });
    return () => { cancelled = true; };
  }, [partyId]);

  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Performance</strong>
        <button className="btn btn-o btn-sm" onClick={onClose}>Close</button>
      </div>
      {loading && <p className="sub">Loading…</p>}
      {!loading && perf && (
        <div className="sub">
          {perf.deliveredCount} delivered · {perf.deliveredCount > 0 ? Math.round((perf.onTimeCount / perf.deliveredCount) * 100) : 0}% on time
          {perf.avgConditionRating != null && <> · {perf.avgConditionRating.toFixed(1)}/5 avg condition rating</>}
        </div>
      )}
    </div>
  );
}
