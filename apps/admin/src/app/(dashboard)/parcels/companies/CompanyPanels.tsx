'use client';

import { useId, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import {
  actionCreateParcelOrg, actionUpdateParcelOrg, actionSearchEnterprises, actionCreateEnterprise,
  actionListParcelOrgStaff, actionCreateParcelOrgManager, actionIssueParcelOrgStaffId,
  type ParcelOrg, type ParcelOrgInput, type EnterpriseLite, type ParcelOrgStaffRow,
} from '../actions';

/**
 * Panels shared by the courier-company register and a company's own page.
 *
 * They live here rather than inside CompaniesManager so the individual
 * company page can render the same team manager and profile form without
 * importing them out of a component named for the list.
 */

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';

export const STATUSES: [value: string, label: string, hint: string][] = [
  ['DRAFT', 'Draft', 'Sign-in link is dead, no parcels route here'],
  ['ACTIVE', 'Active', 'Staff can sign in and carry parcels'],
  ['SUSPENDED', 'Suspended', 'No new work; parcels in flight continue'],
];

export const inputStyle: React.CSSProperties = {
  padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, width: '100%',
};

export function kes(value?: string | null): string {
  if (value == null) return 'KES 0';
  const n = Number(value);
  if (Number.isNaN(n)) return `KES ${value}`;
  return `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
}

export function statusPill(status: string) {
  return `pill ${status === 'ACTIVE' ? 'p-ok' : status === 'DRAFT' ? 'p-warn' : 'p-bad'}`;
}

export function statusLabel(status: string): string {
  return STATUSES.find(([v]) => v === status)?.[1] ?? status;
}

export function orgToInput(org: ParcelOrg, overrides: Partial<ParcelOrgInput> = {}): ParcelOrgInput {
  return {
    name: org.name,
    slug: org.slug,
    status: org.status,
    contactPerson: org.contactPerson,
    contactPhone: org.contactPhone,
    contactEmail: org.contactEmail,
    settlementPhone: org.settlementPhone,
    commissionPct: org.commissionPct,
    acceptsWalkIn: org.acceptsWalkIn,
    lat: org.lat,
    lng: org.lng,
    locationHint: org.locationHint,
    openingHours: org.openingHours,
    ...overrides,
  };
}

const ACTIVITY_LABELS: Record<string, string> = {
  'parcel_org.created': 'Company created',
  'parcel_org.updated': 'Company profile updated',
  'parcel_org.staff_changed': 'Team member changed',
  'parcel_org.staff_id_issued': 'Esoqo ID issued',
  'parcel_org.pricing_changed': 'Pricing changed',
};

export function activityLabel(action: string): string {
  return ACTIVITY_LABELS[action] ?? action.replace(/[._]/g, ' ');
}

export function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 9, background: '#fff' }}>
      <span className="sub" style={{ display: 'block', fontSize: '.72rem' }}>{label}</span>
      <span className="mono" style={{ fontSize: '1.1rem' }}>{value}</span>
    </div>
  );
}

/**
 * A company's team, with the whole lifecycle in one place: add, edit the
 * role, suspend or restore, reset a PIN, and mint the Esoqo ID each
 * person signs in with. Used inline from the register (quick add) and on
 * the company's own page (full management).
 */
export function TeamManager({
  org, initialStaff, canEdit = true,
}: {
  org: ParcelOrg;
  initialStaff?: ParcelOrgStaffRow[];
  canEdit?: boolean;
}) {
  const [staff, setStaff] = useState<ParcelOrgStaffRow[] | null>(initialStaff ?? null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [msisdn, setMsisdn] = useState('');
  const [esokoId, setEsokoId] = useState('');
  const [role, setRole] = useState('MANAGER');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [issuing, setIssuing] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const ids = { name: useId(), pin: useId(), msisdn: useId(), role: useId(), esoko: useId() };

  if (staff === null && !loading) {
    setLoading(true);
    void actionListParcelOrgStaff(org.id).then((rows) => { setStaff(rows); setLoading(false); });
  }

  async function refresh() {
    setStaff(await actionListParcelOrgStaff(org.id));
  }

  async function issue(s: ParcelOrgStaffRow) {
    setError(null);
    setIssuing(s.id);
    const result = await actionIssueParcelOrgStaffId(org.id, s.id);
    setIssuing(null);
    if (!result.ok) { setError(result.error); return; }
    await refresh();
  }

  function toggleActive(s: ParcelOrgStaffRow) {
    setError(null);
    startTransition(async () => {
      const result = await actionCreateParcelOrgManager(org.id, {
        id: s.id, name: s.name, role: s.role, active: !s.active, partyId: s.partyId, stationId: s.stationId,
      });
      if (!result.ok) { setError(result.error); return; }
      await refresh();
    });
  }

  function add() {
    setError(null);
    const phone = msisdn.trim();
    if (!phone && pin.length < 4) {
      setError('Set a PIN, or a phone number to invite them by SMS instead');
      return;
    }
    startTransition(async () => {
      const result = await actionCreateParcelOrgManager(org.id, {
        name: name.trim(), role, pin: phone || esokoId ? undefined : pin, msisdn: phone || undefined, esokoId: esokoId.trim() || undefined,
      });
      if (!result.ok) { setError(result.error); return; }
      setName(''); setPin(''); setMsisdn(''); setEsokoId('');
      await refresh();
    });
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <p className="sub" style={{ margin: '0 0 8px', fontSize: '.82rem' }}>
          They sign in at <span className="mono">/parcel-co/{org.slug}</span>
        </p>
        {staff === null ? (
          <p className="sub">Loading…</p>
        ) : staff.length === 0 ? (
          <p className="sub">
            Nobody yet. Add a manager below and they can build out the rest of the team themselves.
          </p>
        ) : (
          <table className="tbl" style={{ fontSize: '.85rem' }}>
            <thead>
              <tr><th>Name</th><th>Role</th><th>Sign-in ID / phone</th><th>Status</th>{canEdit && <th />}</tr>
            </thead>
            <tbody>
              {staff.map((s) => editingId === s.id ? (
                <tr key={s.id}>
                  <td colSpan={5} style={{ padding: 16, background: 'var(--paper)' }}>
                    <StaffEditForm
                      org={org} member={s}
                      onSaved={() => { setEditingId(null); void refresh(); }}
                      onCancel={() => setEditingId(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td className="sub">{s.role.toLowerCase()}</td>
                  <td>
                    {s.esoqoId ? (
                      <>
                        <span className="mono" style={{ display: 'block' }}>{s.esoqoId}</span>
                        {s.msisdn && <span className="mono sub" style={{ display: 'block' }}>{s.msisdn}</span>}
                      </>
                    ) : s.msisdn ? (
                      <>
                        <span className="sub" style={{ display: 'block', fontSize: '.78rem' }}>No Esoqo ID yet</span>
                        <span className="mono sub" style={{ display: 'block' }}>{s.msisdn}</span>
                      </>
                    ) : s.partyId ? (
                      <span className="mono sub">{s.partyId}<br />No phone on file</span>
                    ) : (
                      <span className="sub">PIN only — no linked person</span>
                    )}
                  </td>
                  <td>
                    <span className={`pill ${s.active ? 'p-ok' : 'p-warn'}`}>
                      {s.active ? 'Can sign in' : 'Suspended'}
                    </span>
                  </td>
                  {canEdit && (
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {!s.esoqoId && s.msisdn && (
                        <button className="btn btn-o btn-sm" disabled={issuing === s.id} onClick={() => void issue(s)}>
                          {issuing === s.id ? 'Issuing…' : 'Issue ID'}
                        </button>
                      )}{' '}
                      <button className="btn btn-o btn-sm" onClick={() => setEditingId(s.id)}>Edit</button>{' '}
                      <button className="btn btn-o btn-sm" disabled={pending} onClick={() => toggleActive(s)}>
                        {s.active ? 'Suspend' : 'Restore'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canEdit && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, alignItems: 'end' }}>
            <div>
              <label className="sub" htmlFor={ids.name} style={{ display: 'block', marginBottom: 4 }}>Name</label>
              <input id={ids.name} style={inputStyle} value={name} placeholder="e.g. Wanjiku"
                onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="sub" htmlFor={ids.esoko} style={{ display: 'block', marginBottom: 4 }}>Existing Esoqo ID</label>
              <input id={ids.esoko} className="mono" style={inputStyle} placeholder="ESK-1234-KE" value={esokoId} disabled={!!msisdn.trim()} onChange={(e) => setEsokoId(e.target.value)} />
            </div>
            <div>
              <label className="sub" htmlFor={ids.role} style={{ display: 'block', marginBottom: 4 }}>Role</label>
              <select id={ids.role} style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="MANAGER">Manager</option>
                <option value="DISPATCHER">Dispatcher</option>
                <option value="RIDER">Rider</option>
              </select>
            </div>
            <div>
              <label className="sub" htmlFor={ids.pin} style={{ display: 'block', marginBottom: 4 }}>PIN</label>
              <input id={ids.pin} className="mono" style={inputStyle} type="password" inputMode="numeric"
                value={pin} disabled={!!msisdn.trim()}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            </div>
            <div>
              <label className="sub" htmlFor={ids.msisdn} style={{ display: 'block', marginBottom: 4 }}>
                Or invite by phone
              </label>
              <input id={ids.msisdn} className="mono" style={inputStyle} placeholder="+2547..."
                value={msisdn} disabled={pin.length > 0}
                onChange={(e) => setMsisdn(e.target.value)} />
            </div>
            <button className="btn btn-p btn-sm" disabled={pending || !name.trim()} onClick={add}>
              {pending ? 'Adding…' : msisdn.trim() ? 'Send invite' : 'Add'}
            </button>
          </div>
          <span className="sub" style={{ fontSize: '.78rem' }}>
            Set a PIN, use an existing Esoqo ID, or enter a phone number instead — they&apos;ll
            get a text with a link to sign in with a one-time code, and nobody else&apos;s number will ever work there.
          </span>
        </>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
    </div>
  );
}

function StaffEditForm({
  org, member, onSaved, onCancel,
}: { org: ParcelOrg; member: ParcelOrgStaffRow; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role);
  const [active, setActive] = useState(member.active);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { name: useId(), role: useId(), pin: useId(), active: useId() };

  function save() {
    setError(null);
    if (!name.trim()) { setError('Give this person a name'); return; }
    startTransition(async () => {
      const result = await actionCreateParcelOrgManager(org.id, {
        id: member.id, name: name.trim(), role, active, partyId: member.partyId,
        stationId: member.stationId, pin: pin || undefined,
      });
      if (!result.ok) { setError(result.error); return; }
      onSaved();
    });
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <div>
          <label className="sub" htmlFor={ids.name} style={{ display: 'block', marginBottom: 4 }}>Name</label>
          <input id={ids.name} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="sub" htmlFor={ids.role} style={{ display: 'block', marginBottom: 4 }}>Role</label>
          <select id={ids.role} style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="MANAGER">Manager</option>
            <option value="DISPATCHER">Dispatcher</option>
            <option value="RIDER">Rider</option>
          </select>
        </div>
        <div>
          <label className="sub" htmlFor={ids.pin} style={{ display: 'block', marginBottom: 4 }}>New PIN (leave blank to keep)</label>
          <input id={ids.pin} className="mono" style={inputStyle} type="password" inputMode="numeric"
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        </div>
      </div>
      <label className="sub" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input id={ids.active} type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Can sign in
      </label>
      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-p btn-sm" disabled={pending || !name.trim()} onClick={save}>
          {pending ? 'Saving…' : 'Save changes'}
        </button>
        <button className="btn btn-o btn-sm" disabled={pending} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function OrgForm({
  initial, submitLabel, onDone, onCancel,
}: { initial?: ParcelOrg; submitLabel: string; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [status, setStatus] = useState(initial?.status ?? 'DRAFT');
  const [commissionPct, setCommissionPct] = useState(String(initial?.commissionPct ?? 15));
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? '');
  const [settlementPhone, setSettlementPhone] = useState(initial?.settlementPhone ?? '');
  const [enterpriseId, setEnterpriseId] = useState(initial?.enterpriseId ?? '');
  const [entQuery, setEntQuery] = useState('');
  const [entResults, setEntResults] = useState<EnterpriseLite[]>([]);
  const [entSearched, setEntSearched] = useState(false);
  const [entName, setEntName] = useState('');
  const [creatingEnt, setCreatingEnt] = useState(false);
  const [newEntName, setNewEntName] = useState('');
  const [entError, setEntError] = useState<string | null>(null);
  const [entPending, startEntTransition] = useTransition();
  const [acceptsWalkIn, setAcceptsWalkIn] = useState(initial?.acceptsWalkIn ?? false);
  const [locationHint, setLocationHint] = useState(initial?.locationHint ?? '');
  const [openingHours, setOpeningHours] = useState(initial?.openingHours ?? '');
  const [lat, setLat] = useState(initial?.lat != null ? String(initial.lat) : '');
  const [lng, setLng] = useState(initial?.lng != null ? String(initial.lng) : '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = {
    name: useId(), slug: useId(), status: useId(), commission: useId(),
    phone: useId(), settlement: useId(), ent: useId(), newEnt: useId(),
    walkIn: useId(), location: useId(), hours: useId(),
  };

  function searchEnterprises(q: string) {
    setEntQuery(q);
    setEntSearched(false);
    if (!q.trim()) { setEntResults([]); return; }
    void actionSearchEnterprises(q).then((results) => { setEntResults(results); setEntSearched(true); });
  }

  function createBusiness() {
    setEntError(null);
    startEntTransition(async () => {
      const result = await actionCreateEnterprise(newEntName);
      if (!result.ok) { setEntError(result.error); return; }
      setEnterpriseId(result.id);
      setEntName(result.name);
      setCreatingEnt(false);
      setNewEntName('');
      setEntResults([]);
    });
  }

  function save() {
    setError(null);
    const input: ParcelOrgInput = {
      // Only sent on create — an update never moves a company to a
      // different owning business, which would silently transfer every
      // parcel it has ever carried.
      ...(initial ? {} : { enterpriseId }),
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      status,
      commissionPct: Number(commissionPct),
      // The contact *person* is managed on Team, not here: a person can
      // leave and the company must carry on unchanged. What's left is the
      // company's own phone line.
      contactPhone: contactPhone.trim() || null,
      settlementPhone: settlementPhone.trim() || null,
      acceptsWalkIn,
      locationHint: acceptsWalkIn ? (locationHint.trim() || null) : null,
      openingHours: acceptsWalkIn ? (openingHours.trim() || null) : null,
      lat: acceptsWalkIn && lat.trim() ? Number(lat) : null,
      lng: acceptsWalkIn && lng.trim() ? Number(lng) : null,
    };
    startTransition(async () => {
      const result = initial
        ? await actionUpdateParcelOrg(initial.id, input)
        : await actionCreateParcelOrg(input);
      if (result.ok) onDone();
      else setError(result.error);
    });
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {!initial && (
        <div>
          <label className="sub" htmlFor={ids.ent} style={{ display: 'block', marginBottom: 4 }}>
            Which business runs it?
          </label>
          <input id={ids.ent} style={inputStyle} value={entName || entQuery}
            placeholder="Search registered businesses"
            disabled={!!enterpriseId}
            onChange={(e) => { setEntName(''); setEnterpriseId(''); searchEnterprises(e.target.value); }} />
          {enterpriseId && (
            <button type="button" className="btn btn-o btn-sm" style={{ marginTop: 6 }}
              onClick={() => { setEnterpriseId(''); setEntName(''); setEntQuery(''); setEntResults([]); setEntSearched(false); }}>
              Change
            </button>
          )}
          {!enterpriseId && entResults.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, border: '1px solid var(--line)', borderRadius: 6 }}>
              {entResults.map((ent) => (
                <li key={ent.id}>
                  <button type="button" className="btn btn-o btn-sm"
                    style={{ width: '100%', textAlign: 'left', border: 'none', borderRadius: 0 }}
                    onClick={() => { setEnterpriseId(ent.id); setEntName(ent.name); setEntResults([]); }}>
                    {ent.name}{ent.msisdn ? ` · ${ent.msisdn}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* The common case: this business has never registered
              anywhere else on the platform, so the search above comes
              back empty. Rather than dead-ending here (which is the
              whole reason this form was "the hardest of them all" —
              the only other way an Enterprise gets created is the
              public /join flow, OTP and all), staff can register it
              on the spot. */}
          {!enterpriseId && entSearched && entResults.length === 0 && entQuery.trim() && !creatingEnt && (
            <button type="button" className="btn btn-o btn-sm" style={{ marginTop: 6 }}
              onClick={() => { setCreatingEnt(true); setNewEntName(entQuery.trim()); }}>
              <Icon name="plus" size={13} />No match — register &quot;{entQuery.trim()}&quot; as a new business
            </button>
          )}
          {creatingEnt && (
            <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--line)', borderRadius: 6, display: 'grid', gap: 8 }}>
              <label className="sub" htmlFor={ids.newEnt} style={{ display: 'block' }}>
                Business&apos;s registered name
              </label>
              <input id={ids.newEnt} style={inputStyle} value={newEntName}
                onChange={(e) => setNewEntName(e.target.value)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-p btn-sm" disabled={entPending || !newEntName.trim()}
                  onClick={createBusiness}>
                  {entPending ? 'Registering…' : 'Register business'}
                </button>
                <button type="button" className="btn btn-o btn-sm" disabled={entPending}
                  onClick={() => { setCreatingEnt(false); setEntError(null); }}>
                  Cancel
                </button>
              </div>
              {entError && (
                <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', margin: 0 }}>{entError}</p>
              )}
            </div>
          )}
          <span className="sub" style={{ fontSize: '.78rem' }}>
            A courier company hangs off a business record on the platform, the same way a shop and a
            ticket organiser do — search for one that&apos;s already registered, or register it now.
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div>
          <label className="sub" htmlFor={ids.name} style={{ display: 'block', marginBottom: 4 }}>Trading name</label>
          <input id={ids.name} style={inputStyle} value={name} placeholder="e.g. Swift Riders Ltd"
            onChange={(e) => {
              setName(e.target.value);
              // Suggest a slug from the name on create only — changing a
              // live company's slug breaks the link its staff have saved.
              if (!initial) {
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
              }
            }} />
        </div>
        <div>
          <label className="sub" htmlFor={ids.slug} style={{ display: 'block', marginBottom: 4 }}>
            Sign-in link
          </label>
          <input id={ids.slug} className="mono" style={inputStyle} value={slug}
            onChange={(e) => setSlug(e.target.value)} />
          <span className="sub" style={{ fontSize: '.78rem' }}>/parcel-co/{slug || '…'}</span>
        </div>
        <div>
          <label className="sub" htmlFor={ids.commission} style={{ display: 'block', marginBottom: 4 }}>
            Esoqo commission
          </label>
          <input id={ids.commission} className="mono" style={inputStyle} value={commissionPct}
            onChange={(e) => setCommissionPct(e.target.value)} />
          <span className="sub" style={{ fontSize: '.78rem' }}>
            % of each parcel. Frozen onto a parcel when it&apos;s paid for.
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div>
          <label className="sub" htmlFor={ids.phone} style={{ display: 'block', marginBottom: 4 }}>Company phone</label>
          <input id={ids.phone} style={inputStyle} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          <span className="sub" style={{ fontSize: '.78rem' }}>
            The company&apos;s own line. People — including its contact — live on Team.
          </span>
        </div>
        <div>
          <label className="sub" htmlFor={ids.settlement} style={{ display: 'block', marginBottom: 4 }}>
            Settlement M-Pesa
          </label>
          <input id={ids.settlement} style={inputStyle} value={settlementPhone}
            onChange={(e) => setSettlementPhone(e.target.value)} />
        </div>
        <div>
          <label className="sub" htmlFor={ids.status} style={{ display: 'block', marginBottom: 4 }}>Status</label>
          <select id={ids.status} style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <span className="sub" style={{ fontSize: '.78rem' }}>
            {STATUSES.find(([v]) => v === status)?.[2]}
          </span>
        </div>
      </div>

      <div>
        <label className="sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={acceptsWalkIn} onChange={(e) => setAcceptsWalkIn(e.target.checked)} />
          Takes walk-in drop-offs
        </label>
        <span className="sub" style={{ fontSize: '.78rem' }}>
          Lets a sender pick this company&apos;s own desk in the booking form and hand a parcel over
          in person, instead of only a scheduled pickup.
        </span>
      </div>

      {acceptsWalkIn && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label className="sub" htmlFor={ids.location} style={{ display: 'block', marginBottom: 4 }}>
              Desk location
            </label>
            <input id={ids.location} style={inputStyle} value={locationHint}
              placeholder="e.g. Ground floor, Kenyatta Ave, next to the post office"
              onChange={(e) => setLocationHint(e.target.value)} />
          </div>
          <div>
            <label className="sub" htmlFor={ids.hours} style={{ display: 'block', marginBottom: 4 }}>
              Opening hours
            </label>
            <input id={ids.hours} style={inputStyle} value={openingHours}
              placeholder="e.g. Mon-Sat 8am-6pm" onChange={(e) => setOpeningHours(e.target.value)} />
          </div>
          <div>
            <span className="sub" style={{ display: 'block', marginBottom: 4 }}>Coordinates (optional)</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="mono" style={inputStyle} value={lat} placeholder="lat"
                onChange={(e) => setLat(e.target.value)} />
              <input className="mono" style={inputStyle} value={lng} placeholder="lng"
                onChange={(e) => setLng(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-p btn-sm"
          disabled={pending || !name.trim() || !slug.trim() || (!initial && !enterpriseId) || (acceptsWalkIn && !locationHint.trim())}
          onClick={save}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        <button className="btn btn-o btn-sm" disabled={pending} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
