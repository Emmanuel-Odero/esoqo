'use client';

import { displayKES, toCentsOrZero, toWire } from '@esoqo/domain';
import { useId, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import {
  actionCreateParcelAgent, actionUpdateParcelAgent,
  type ParcelAgent, type ParcelAgentInput, type ParcelZone,
} from '../actions';

/**
 * The pickup-point network — a real shop that holds parcels for
 * collection, with a person, a phone, opening hours and finite shelf
 * space.
 *
 * Deliberately a sibling of the zones table rather than part of it: a
 * zone is a pricing coordinate, an agent is a place custody actually
 * sits. Several agents share one zone, and a zone with no agents still
 * prices fine.
 *
 * Shelf usage is shown per row because it is the thing that silently
 * breaks dispatch — a full shop is refused at booking and at drop-off,
 * and an operator needs to see it filling up before a courier is
 * standing in the doorway being told no.
 */
export function AgentsEditor({
  agents, zones, canEdit,
}: { agents: ParcelAgent[]; zones: ParcelZone[]; canEdit: boolean }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Shop</th><th>Where</th><th>Phone</th><th>Hours</th>
              <th>Shelf</th><th>Fee</th><th>Active</th>{canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => <AgentRow key={a.id} agent={a} zones={zones} canEdit={canEdit} />)}
            {agents.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 8 : 7} className="sub" style={{ textAlign: 'center', padding: 24 }}>
                  No pickup points yet. Add one and senders can choose collection instead of doorstep.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div style={{ padding: 16, borderTop: '1px solid var(--line)' }}>
          <NewAgentForm zones={zones} />
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, width: '100%',
};

function AgentRow({ agent, zones, canEdit }: { agent: ParcelAgent; zones: ParcelZone[]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const full = agent.capacity > 0 && agent.parcelsHeld >= agent.capacity;

  if (editing) {
    return (
      <tr>
        <td colSpan={8} style={{ padding: 16 }}>
          <AgentForm
            zones={zones}
            initial={agent}
            submitLabel="Save changes"
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <strong>{agent.name}</strong>
        {agent.zoneName && <span className="sub" style={{ display: 'block' }}>{agent.zoneName}</span>}
      </td>
      <td className="sub">{agent.locationHint}</td>
      <td className="mono sub">{agent.msisdn}</td>
      <td className="sub">{agent.openingHours ?? '—'}</td>
      <td>
        <span className={`pill ${full ? 'p-bad' : 'p-ok'}`}>
          {agent.parcelsHeld} / {agent.capacity}
        </span>
      </td>
      <td className="mono">{toCentsOrZero(agent.holdingFeeKes) > 0 ? `KES ${displayKES(agent.holdingFeeKes)}` : "—"}</td>
      <td>
        <span className={`pill ${agent.active ? 'p-ok' : 'p-warn'}`}>
          {agent.active ? 'Active' : 'Off'}
        </span>
      </td>
      {canEdit && (
        <td style={{ textAlign: 'right' }}>
          <button className="btn btn-o btn-sm" onClick={() => setEditing(true)}>Edit</button>
        </td>
      )}
    </tr>
  );
}

function NewAgentForm({ zones }: { zones: ParcelZone[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="btn btn-o btn-sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} />Add a pickup point
      </button>
    );
  }
  return (
    <AgentForm
      zones={zones}
      submitLabel="Add pickup point"
      onDone={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    />
  );
}

function AgentForm({
  zones, initial, submitLabel, onDone, onCancel,
}: {
  zones: ParcelZone[]; initial?: ParcelAgent; submitLabel: string;
  onDone: () => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [zoneId, setZoneId] = useState(initial?.zoneId ?? '');
  const [lat, setLat] = useState(initial ? String(initial.lat) : '');
  const [lng, setLng] = useState(initial ? String(initial.lng) : '');
  const [msisdn, setMsisdn] = useState(initial?.msisdn ?? '');
  const [locationHint, setLocationHint] = useState(initial?.locationHint ?? '');
  const [openingHours, setOpeningHours] = useState(initial?.openingHours ?? '');
  const [capacity, setCapacity] = useState(initial ? String(initial.capacity) : '50');
  const [holdingFeeKes, setHoldingFeeKes] = useState(initial ? String(initial.holdingFeeKes) : '0');
  const [active, setActive] = useState(initial?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Unique per form instance so the "Taking parcels" checkbox and its
  // label still pair correctly when an edit row and the add form are
  // both open at once.
  const activeId = useId();
  const zoneFieldId = useId();

  function save() {
    setError(null);
    const input: ParcelAgentInput = {
      name: name.trim(),
      zoneId: zoneId || null,
      lat: Number(lat),
      lng: Number(lng),
      msisdn: msisdn.trim(),
      locationHint: locationHint.trim(),
      openingHours: openingHours.trim() || null,
      capacity: Number(capacity),
      holdingFeeKes: toWire(toCentsOrZero(holdingFeeKes)),
      active,
    };
    startTransition(async () => {
      const result = initial
        ? await actionUpdateParcelAgent(initial.id, input)
        : await actionCreateParcelAgent(input);
      if (result.ok) onDone();
      else setError(result.error);
    });
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Field label="Shop name" value={name} onChange={setName} placeholder="e.g. Mama Njeri's Shop" />
        <div>
          <label className="sub" htmlFor={zoneFieldId} style={{ display: 'block', marginBottom: 4 }}>
            Pricing zone (optional)
          </label>
          <select id={zoneFieldId} style={inputStyle} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
            <option value="">None</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </div>
        <Field label="Phone" value={msisdn} onChange={setMsisdn} placeholder="+2547XXXXXXXX" />
      </div>

      {/* The one field a receiver actually navigates by. Coordinates
          drive the "nearest shops" search; this is what gets read out
          over the phone. */}
      <Field
        label="How to find it"
        value={locationHint}
        onChange={setLocationHint}
        placeholder="e.g. Shop 4, Ngara Road, next to the Total station"
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <Field label="Latitude" value={lat} onChange={setLat} mono placeholder="-1.2864" />
        <Field label="Longitude" value={lng} onChange={setLng} mono placeholder="36.8172" />
        <Field label="Shelf capacity" value={capacity} onChange={setCapacity} mono />
        <Field label="Collection fee (KES)" value={holdingFeeKes} onChange={setHoldingFeeKes} mono />
      </div>

      <Field
        label="Opening hours (free text)"
        value={openingHours}
        onChange={setOpeningHours}
        placeholder="e.g. Mon-Sat 8am-7pm, Sun closed"
      />

      <label className="sub" htmlFor={activeId} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input id={activeId} type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Taking parcels
      </label>

      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}

      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-p btn-sm" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        <button className="btn btn-o btn-sm" disabled={pending} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, mono,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; mono?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label className="sub" htmlFor={id} style={{ display: 'block', marginBottom: 4 }}>{label}</label>
      <input
        id={id}
        className={mono ? 'mono' : undefined}
        style={inputStyle}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
