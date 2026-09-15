'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionSetCapabilities, actionApplyPreset, actionSetActive, actionCreateStaff } from './actions';

interface Staff {
  id: string; name: string; email: string; rolePreset: string;
  capabilities: string[]; active: boolean; approvals: number;
  lastSeenAt: string | null; mustChangePin: boolean;
}
type Catalogue = { group: string; items: [string, string][] }[];

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super admin', ESOKO_OPS: 'Operations', REGISTRAR: 'Registrar',
  FINANCE_APPROVER: 'Finance approver', VIEWER: 'Viewer', CUSTOM: 'Custom',
  CECF_OFFICER: 'CECF officer', FIELD_AGENT: 'Field agent',
};

export function StaffTable({
  staff, catalogue, presets, canEdit, selfId,
}: {
  staff: Staff[]; catalogue: Catalogue; presets: string[];
  canEdit: boolean; selfId: string | null;
}) {
  const [editing, setEditing] = useState<Staff | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="ctl">
        <span className="sub" style={{ marginRight: 'auto' }}>{staff.length} accounts</span>
        {canEdit && (
          <button className="btn btn-p" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} />Add someone
          </button>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Person</th><th>Role</th><th>Permissions</th>
              <th className="num">Signatures</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => {
              const isSuper = s.capabilities.includes('*');
              const isSelf = s.id === selfId;
              return (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    {isSelf && <span className="pill p-info" style={{ marginLeft: 7 }}>You</span>}
                    <span className="sub" style={{ display: 'block' }}>{s.email}</span>
                  </td>
                  <td>
                    <span className={`pill ${isSuper ? 'p-bad' : 'p-info'}`}>
                      {ROLE_LABEL[s.rolePreset] ?? s.rolePreset}
                    </span>
                  </td>
                  <td className="mono sub">
                    {isSuper ? 'Everything' : `${s.capabilities.length} granted`}
                    {s.capabilities.includes('payment.approve') && (
                      <span className="pill p-ok" style={{ marginLeft: 6 }}>
                        <Icon name="check" size={11} />Can sign
                      </span>
                    )}
                  </td>
                  <td className="num">{s.approvals}</td>
                  <td>
                    {!s.active
                      ? <span className="pill p-bad">Suspended</span>
                      : s.mustChangePin
                        ? <span className="pill p-warn">PIN not set</span>
                        : <span className="pill p-ok">Active</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {canEdit && !isSelf && (
                      <button className="btn btn-o btn-sm" onClick={() => setEditing(s)}>
                        <Icon name="key" size={14} />Permissions
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <CapabilityEditor staff={editing} catalogue={catalogue} presets={presets}
          onClose={() => setEditing(null)} />
      )}
      {creating && <CreateStaff presets={presets} onClose={() => setCreating(false)} />}
    </>
  );
}

function CapabilityEditor({
  staff, catalogue, presets, onClose,
}: { staff: Staff; catalogue: Catalogue; presets: string[]; onClose: () => void }) {
  const [caps, setCaps] = useState<string[]>(staff.capabilities);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const announce = useAnnounce();
  const isSuper = staff.capabilities.includes('*');

  const toggle = (c: string) =>
    setCaps((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  function save() {
    setError(null);
    start(async () => {
      const r = await actionSetCapabilities(staff.id, caps);
      if (r.ok) { announce(`Permissions updated for ${staff.name}`, 'assertive'); onClose(); }
      else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  function preset(p: string) {
    start(async () => {
      const r = await actionApplyPreset(staff.id, p);
      if (r.ok) { announce(`${p} role applied`, 'assertive'); onClose(); }
      else setError(r.error);
    });
  }

  function suspend() {
    start(async () => {
      const r = await actionSetActive(staff.id, !staff.active, 'Changed from the staff page');
      if (r.ok) onClose(); else setError(r.error);
    });
  }

  return (
    <div className="scrim" role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cap-title">
        <div className="modal-hd">
          <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--green-t)', color: 'var(--green)', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <Icon name="key" size={19} />
          </span>
          <div>
            <h2 id="cap-title">{staff.name}</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>{staff.email}</p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

        <div className="modal-bd">
          {isSuper && (
            <p className="pill p-bad" style={{ padding: '10px 13px', marginBottom: 18 }}>
              <Icon name="alert-triangle" size={14} />
              This account holds every permission. Editing the list below replaces that.
            </p>
          )}

          <div style={{ marginBottom: 20 }}>
            <p className="sub" style={{ marginBottom: 8 }}>Apply a role preset</p>
            <div className="ctl" style={{ margin: 0 }}>
              {presets.map((p) => (
                <button key={p} className="btn btn-o btn-sm" disabled={pending}
                  onClick={() => preset(p)}>
                  {ROLE_LABEL[p] ?? p}
                </button>
              ))}
            </div>
          </div>

          <div className="caps">
            {catalogue.map((g) => (
              <div className="capgroup" key={g.group}>
                <h3>{g.group}</h3>
                {g.items.map(([cap, label]) => (
                  <label key={cap}>
                    <input type="checkbox" checked={caps.includes(cap)} onChange={() => toggle(cap)} />
                    <span>
                      {label}
                      <code>{cap}</code>
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>

          {error && (
            <p className="pill p-bad" style={{ marginTop: 16, padding: '10px 13px' }} role="alert">
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>

        <div className="modal-ft">
          <button className="btn btn-o" style={{ marginRight: 'auto' }} onClick={suspend} disabled={pending}>
            <Icon name={staff.active ? 'ban' : 'check'} size={15} />
            {staff.active ? 'Suspend account' : 'Reinstate'}
          </button>
          <button className="btn btn-o" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" onClick={save} disabled={pending}>
            <Icon name="check" size={15} />Save {caps.length} permissions
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateStaff({ presets, onClose }: { presets: string[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('VIEWER');
  const [tempPin, setTempPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function create() {
    setError(null);
    start(async () => {
      const r = await actionCreateStaff({ name, email, rolePreset: role });
      if (r.ok) setTempPin((r.data as { tempPin: string }).tempPin);
      else setError(r.error);
    });
  }

  return (
    <div className="scrim" role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="cs-title">
        <div className="modal-hd">
          <h2 id="cs-title">Add someone to the team</h2>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

        <div className="modal-bd">
          {tempPin ? (
            <>
              <p className="pill p-ok" style={{ padding: '10px 13px', marginBottom: 16 }}>
                <Icon name="check-circle" size={14} />Account created
              </p>
              <p>
                Give <strong>{name}</strong> this temporary PIN. It is shown once and never stored
                in readable form — they must change it at first sign-in.
              </p>
              <p className="mono" style={{ fontSize: '2rem', letterSpacing: '.4em', textAlign: 'center', padding: '18px 0', background: 'var(--paper)', borderRadius: 10, margin: '14px 0' }}>
                {tempPin}
              </p>
              <p className="sub">Do not send this by SMS or email. Hand it over in person or by phone.</p>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 14 }}>
                <label className="sub" htmlFor="cs-name" style={{ display: 'block', marginBottom: 6 }}>Full name</label>
                <input id="cs-name" className="inp" style={{ width: '100%' }} value={name}
                  onChange={(e) => setName(e.target.value)} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label className="sub" htmlFor="cs-email" style={{ display: 'block', marginBottom: 6 }}>Work email</label>
                <input id="cs-email" className="inp" type="email" style={{ width: '100%' }} value={email}
                  onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="sub" htmlFor="cs-role" style={{ display: 'block', marginBottom: 6 }}>Starting role</label>
                <select id="cs-role" className="inp" style={{ width: '100%' }} value={role}
                  onChange={(e) => setRole(e.target.value)}>
                  {presets.map((p) => <option key={p} value={p}>{ROLE_LABEL[p] ?? p}</option>)}
                </select>
                <p className="sub" style={{ marginTop: 6 }}>
                  You can fine-tune individual permissions afterwards.
                </p>
              </div>
              {error && (
                <p className="pill p-bad" style={{ marginTop: 14, padding: '10px 13px' }} role="alert">
                  <Icon name="alert-circle" size={14} />{error}
                </p>
              )}
            </>
          )}
        </div>

        <div className="modal-ft">
          {tempPin ? (
            <button className="btn btn-p" onClick={onClose}>Done</button>
          ) : (
            <>
              <button className="btn btn-o" onClick={onClose}>Cancel</button>
              <button className="btn btn-p" onClick={create} disabled={pending || !name || !email}>
                <Icon name="plus" size={15} />Create account
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
