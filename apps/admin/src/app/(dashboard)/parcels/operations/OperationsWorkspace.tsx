'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@esoqo/ui';
import {
  actionCaptureParcelIntake,
  actionCreateParcelShipment,
  actionFinishParcelShipment,
  actionListParcelOpsQueue,
  actionLoadParcelToShipment,
  actionOffloadParcelFromShipment,
  actionRejectParcelAtDropoff,
  actionSendPickupReminder,
  actionStartParcelShipment,
  type ParcelOpsQueueRow,
  type ParcelShipmentView,
} from '../actions';

type Tab = 'intake' | 'shipments' | 'queues';
const tabs: { id: Tab; label: string }[] = [
  { id: 'intake', label: 'Receive parcel' },
  { id: 'shipments', label: 'Shipments' },
  { id: 'queues', label: 'Work queues' },
];

export function OperationsWorkspace({ initialQueue }: { initialQueue: ParcelOpsQueueRow[] }) {
  const [tab, setTab] = useState<Tab>('intake');
  const [queue, setQueue] = useState(initialQueue);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function feedback(message: string) { setNotice(message); setError(null); }
  function fail(message: string) { setError(message); setNotice(null); }

  async function refreshQueue(filter = 'all') {
    try { setQueue(await actionListParcelOpsQueue(filter)); } catch (e) { fail(e instanceof Error ? e.message : 'Could not refresh the queue'); }
  }

  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {tabs.map((item) => (
          <button key={item.id} type="button" className={`btn btn-sm ${tab === item.id ? 'btn-p' : 'btn-o'}`} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      {notice && <div className="chain" style={{ marginBottom: 14 }}><Icon name="check-circle" size={17} /><span>{notice}</span></div>}
      {error && <div className="chain" style={{ marginBottom: 14, color: 'var(--red)' }}><Icon name="alert-circle" size={17} /><span>{error}</span></div>}
      {tab === 'intake' && <IntakePanel onDone={feedback} onError={fail} />}
      {tab === 'shipments' && <ShipmentPanel onDone={feedback} onError={fail} />}
      {tab === 'queues' && <QueuePanel rows={queue} onRefresh={refreshQueue} onDone={feedback} onError={fail} />}
    </div>
  );
}

function IntakePanel({ onDone, onError }: { onDone: (message: string) => void; onError: (message: string) => void }) {
  const [code, setCode] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [condition, setCondition] = useState('GOOD');
  const [perishable, setPerishable] = useState(false);
  const [handling, setHandling] = useState('');
  const [expiryAt, setExpiryAt] = useState('');
  const [declaredValue, setDeclaredValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function submit() {
    if (!code.trim() || !category || !description.trim()) { onError('Scan the label and complete the item details.'); return; }
    const result = await actionCaptureParcelIntake(code.trim().toUpperCase(), {
      itemCategory: category, itemDescription: description.trim(), condition, perishable,
      perishableHandling: perishable ? handling : undefined, expiryAt: perishable && expiryAt ? new Date(expiryAt).toISOString() : undefined,
      declaredValueKes: declaredValue ? Number(declaredValue) : undefined,
    });
    if (!result.ok) { onError(result.error); return; }
    onDone(`Parcel ${code.toUpperCase()} received. Sender notification sent.`);
    setCode(''); setCategory(''); setDescription(''); setCondition('GOOD'); setPerishable(false); setHandling(''); setExpiryAt(''); setDeclaredValue('');
    inputRef.current?.focus();
  }

  async function reject() {
    if (!code.trim()) { onError('Scan the parcel before rejecting it.'); return; }
    const reason = window.prompt('Reason for rejection')?.trim();
    if (!reason) return;
    const result = await actionRejectParcelAtDropoff(code.trim().toUpperCase(), reason);
    if (!result.ok) { onError(result.error); return; }
    onDone(`Parcel ${code.toUpperCase()} rejected. Sender notification sent.`);
    setCode(''); inputRef.current?.focus();
  }

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <p className="sub" style={{ marginTop: 0 }}>Scan the pre-printed label. Capture only what is visible at the counter.</p>
      <label className="sub">Parcel label
        <input ref={inputRef} className="mono" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }} placeholder="PKG-XXXXXX" autoComplete="off" style={inputStyle} />
      </label>
      <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <label className="sub" style={{ flex: 1, minWidth: 190 }}>Item category
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
            <option value="">Choose category</option><option>Documents</option><option>Clothing</option><option>Electronics</option><option>Food</option><option>Medicine</option><option>Household goods</option><option>Other</option>
          </select>
        </label>
        <label className="sub" style={{ flex: 1, minWidth: 190 }}>Condition
          <select value={condition} onChange={(e) => setCondition(e.target.value)} style={inputStyle}><option value="GOOD">Good</option><option value="DAMAGED">Damaged</option><option value="OPENED">Opened</option><option value="WET">Wet</option><option value="SEAL_BROKEN">Seal broken</option></select>
        </label>
      </div>
      <label className="sub" style={{ display: 'block', marginTop: 14 }}>Short description
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Example: blue shirt" style={inputStyle} />
      </label>
      <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 180 }}><input type="checkbox" checked={perishable} onChange={(e) => setPerishable(e.target.checked)} /> Perishable</label>
        <label className="sub" style={{ flex: 1, minWidth: 180 }}>Declared value (KES)
          <input type="number" min="0" value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} placeholder="Optional" style={inputStyle} />
        </label>
      </div>
      {perishable && <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}><label className="sub" style={{ flex: 1 }}>Handling<select value={handling} onChange={(e) => setHandling(e.target.value)} style={inputStyle}><option value="">Choose handling</option><option>Ambient</option><option>Chilled</option><option>Frozen</option></select></label><label className="sub" style={{ flex: 1 }}>Expiry date<input type="datetime-local" value={expiryAt} onChange={(e) => setExpiryAt(e.target.value)} style={inputStyle} /></label></div>}
      <div className="row" style={{ gap: 8, marginTop: 20, flexWrap: 'wrap' }}><button type="button" className="btn btn-p" onClick={() => void submit()}><Icon name="check-circle" size={16} />Receive parcel</button><button type="button" className="btn btn-o" onClick={() => void reject()}><Icon name="alert-circle" size={16} />Reject at counter</button></div>
    </div>
  );
}

function ShipmentPanel({ onDone, onError }: { onDone: (message: string) => void; onError: (message: string) => void }) {
  const [shipment, setShipment] = useState<ParcelShipmentView | null>(null);
  const [code, setCode] = useState('');
  const [form, setForm] = useState({ originLabel: '', destinationLabel: '', routeLabel: '', vehiclePlate: '', driverPartyId: '', conductorPartyId: '' });
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'load' | 'offload'>('load');

  async function create() {
    if (!form.originLabel || !form.destinationLabel) { onError('Origin and destination are required.'); return; }
    const result = await actionCreateParcelShipment(form);
    if (!result.ok) { onError(result.error); return; }
    setShipment(result.shipment); onDone('Shipment created. Scan the first parcel.'); inputRef.current?.focus();
  }
  async function scan() {
    if (!shipment || !code.trim()) return;
    const result = mode === 'load' ? await actionLoadParcelToShipment(shipment.id, code.trim().toUpperCase()) : await actionOffloadParcelFromShipment(shipment.id, code.trim().toUpperCase());
    if (!result.ok) { onError(result.error); return; }
    setShipment(result.shipment); setCode(''); onDone(`${mode === 'load' ? 'Loaded' : 'Offloaded'} ${code.trim().toUpperCase()}. Scan next.`); inputRef.current?.focus();
  }
  async function transition(action: () => Promise<{ ok: true; shipment: ParcelShipmentView } | { ok: false; error: string }>, message: string) { const result = await action(); if (!result.ok) { onError(result.error); return; } setShipment(result.shipment); onDone(message); }

  return <div className="card" style={{ maxWidth: 860 }}>
    {!shipment ? <>
      <h3 style={{ marginTop: 0 }}>Create shipment</h3>
      <p className="sub">Create one vehicle movement, then scan parcels into it.</p>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>{(['originLabel', 'destinationLabel', 'routeLabel', 'vehiclePlate'] as const).map((key) => <label key={key} className="sub" style={{ flex: 1, minWidth: 180 }}>{key === 'originLabel' ? 'From' : key === 'destinationLabel' ? 'To' : key === 'routeLabel' ? 'Route' : 'Vehicle'}<input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} style={inputStyle} /></label>)}</div>
      <button type="button" className="btn btn-p" style={{ marginTop: 18 }} onClick={() => void create()}>Create shipment</button>
    </> : <>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}><div><p className="sub" style={{ margin: 0 }}>Shipment</p><h3 style={{ margin: '4px 0' }}>{shipment.originLabel} to {shipment.destinationLabel}</h3><p className="sub" style={{ margin: 0 }}>{shipment.vehiclePlate || 'Vehicle not set'} · {shipment.status}</p></div><div className="kpi g" style={{ minWidth: 130 }}><span className="l">Loaded / offloaded</span><span className="n">{shipment.loaded} / {shipment.offloaded}</span></div></div>
      <div className="row" style={{ gap: 8, margin: '20px 0 12px', flexWrap: 'wrap' }}><button type="button" className={`btn btn-sm ${mode === 'load' ? 'btn-p' : 'btn-o'}`} onClick={() => setMode('load')}>Load parcels</button><button type="button" className={`btn btn-sm ${mode === 'offload' ? 'btn-p' : 'btn-o'}`} onClick={() => setMode('offload')}>Offload parcels</button></div>
      <div className="row" style={{ gap: 8 }}><input ref={inputRef} className="mono" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void scan(); } }} placeholder="Scan parcel label" style={{ ...inputStyle, flex: 1 }} /><button type="button" className="btn btn-p" disabled={!code.trim()} onClick={() => void scan()}>{mode === 'load' ? 'Load next' : 'Offload next'}</button></div>
      <div className="row" style={{ gap: 8, marginTop: 18, flexWrap: 'wrap' }}>{shipment.status === 'OPEN' && <button type="button" className="btn btn-o" onClick={() => void transition(() => actionStartParcelShipment(shipment.id), 'Shipment departed.')}>Start shipment</button>}{shipment.status === 'DEPARTED' && <button type="button" className="btn btn-o" onClick={() => void transition(() => actionFinishParcelShipment(shipment.id), 'Shipment arrived.')}>Finish arrival</button>}<button type="button" className="btn btn-o" onClick={() => setShipment(null)}>New shipment</button></div>
    </>}
  </div>;
}

function QueuePanel({ rows, onRefresh, onDone, onError }: { rows: ParcelOpsQueueRow[]; onRefresh: (queue: string) => Promise<void>; onDone: (message: string) => void; onError: (message: string) => void }) {
  const [filter, setFilter] = useState('all');
  const filters: [string, string][] = [['all', 'All action'], ['ready_to_load', 'Ready to load'], ['collection', 'Collection'], ['perishable', 'Perishable'], ['rejected', 'Rejected'], ['left_behind', 'Left behind'], ['arrival_exception', 'Arrival exceptions']];
  async function refresh(next: string) { setFilter(next); await onRefresh(next); }
  async function remind(code: string) { const result = await actionSendPickupReminder(code); if (!result.ok) { onError(result.error); return; } onDone(`Pickup reminder sent for ${code}.`); await onRefresh(filter); }
  return <div><div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>{filters.map(([value, label]) => <button key={value} type="button" className={`btn btn-sm ${filter === value ? 'btn-p' : 'btn-o'}`} onClick={() => void refresh(value)}>{label}</button>)}</div><div className="card" style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr><th>Parcel</th><th>Receiver</th><th>Destination</th><th>Status</th><th>Risk</th><th>Action</th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={6} className="sub">No parcels need attention.</td></tr> : rows.map((row) => <tr key={row.code}><td className="mono">{row.code}</td><td>{row.receiverName}</td><td>{row.destinationLabel}</td><td>{row.status}</td><td>{row.perishable ? `Perishable${row.expiryAt ? ` · ${new Date(row.expiryAt).toLocaleDateString()}` : ''}` : row.declaredValueKes ? `KES ${row.declaredValueKes}` : 'Normal'}</td><td>{row.status === 'HELD_AT_AGENT' && <button type="button" className="btn btn-o btn-sm" onClick={() => void remind(row.code)}>Remind</button>}</td></tr>)}</tbody></table></div></div>;
}

const inputStyle: React.CSSProperties = { width: '100%', marginTop: 4, padding: '10px 12px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem' };
