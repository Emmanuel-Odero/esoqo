'use client';

import { useRef, useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { actionSearchPeople, actionAddMember, actionSetRole, actionRemoveMember } from './actions';

type Role = 'CHAIRPERSON' | 'TREASURER' | 'SECRETARY' | 'MEMBER';

interface Member {
  membershipId: string; partyId: string; name: string; role: Role | string; joinedAt: string;
}
interface Group {
  id: string; name: string; knownAs: string | null; kind: string;
  county: string; registrationNo: string | null; members: Member[];
}

const ROLES: Role[] = ['CHAIRPERSON', 'TREASURER', 'SECRETARY', 'MEMBER'];
const ROLE_LABEL: Record<string, string> = {
  CHAIRPERSON: 'Chairperson', TREASURER: 'Treasurer', SECRETARY: 'Secretary', MEMBER: 'Member',
};
const OFFICE = new Set(['CHAIRPERSON', 'TREASURER', 'SECRETARY']);

export function GroupManager({ groups, canEdit }: { groups: Group[]; canEdit: boolean }) {
  const [sel, setSel] = useState<string | null>(groups[0]?.id ?? null);
  const [q, setQ] = useState('');

  const view = groups.filter((g) =>
    !q || `${g.name} ${g.knownAs ?? ''} ${g.county}`.toLowerCase().includes(q.toLowerCase()));
  const current = groups.find((g) => g.id === sel);

  return (
    <div className="grid2" style={{ gridTemplateColumns: '320px 1fr', alignItems: 'start' }}>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: 14, borderBottom: '1px solid var(--line)' }}>
          <div className="srch">
            <span className="mg"><Icon name="search" size={16} /></span>
            <input className="inp" value={q} onChange={(e) => setQ(e.target.value)}
              aria-label="Search groups" placeholder="Search groups…" />
          </div>
        </div>

        {view.length === 0 ? (
          <div className="empty" style={{ padding: 30 }}>
            <span className="ico"><Icon name="handshake" size={20} /></span>
            <h3>No groups yet</h3>
            <p style={{ margin: 0, fontSize: '.88rem' }}>
              A group appears here when someone registers one during joining.
            </p>
          </div>
        ) : (
          <div role="tablist" aria-label="Groups">
            {view.map((g) => (
              <button key={g.id} role="tab" aria-selected={sel === g.id}
                onClick={() => setSel(g.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', border: 0,
                  borderBottom: '1px solid var(--line)', padding: '13px 16px', cursor: 'pointer',
                  fontFamily: 'inherit', background: sel === g.id ? 'var(--green-t)' : '#fff',
                  borderLeft: `3px solid ${sel === g.id ? 'var(--green)' : 'transparent'}`,
                }}>
                <strong style={{ fontSize: '.92rem', display: 'block' }}>{g.name}</strong>
                <span className="sub" style={{ fontSize: '.79rem' }}>
                  {g.county} · {g.members.length} {g.members.length === 1 ? 'member' : 'members'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {current ? (
        <GroupDetail group={current} canEdit={canEdit} />
      ) : (
        <div className="card"><div className="empty"><p>Select a group.</p></div></div>
      )}
    </div>
  );
}

function GroupDetail({ group, canEdit }: { group: Group; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  const officeHolders = group.members.filter((m) => OFFICE.has(m.role));
  const missingOffices = ROLES.slice(0, 3).filter(
    (r) => !group.members.some((m) => m.role === r));

  function changeRole(m: Member, role: Role) {
    start(async () => {
      const r = await actionSetRole(m.membershipId, role);
      if (r.ok) announce(`${m.name} is now ${ROLE_LABEL[role]}`, 'assertive');
      else setError(r.error);
    });
  }

  function remove() {
    if (!removing || !reason.trim()) return;
    start(async () => {
      const r = await actionRemoveMember(removing.membershipId, reason);
      if (r.ok) {
        announce(`${removing.name} removed from the group`, 'assertive');
        setRemoving(null); setReason('');
      } else setError(r.error);
    });
  }

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 18 }}>
          <span style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--blue-t)', color: 'var(--blue)', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <Icon name="handshake" size={21} />
          </span>
          <div style={{ flex: 1 }}>
            <h2 style={{ marginBottom: 3 }}>{group.name}</h2>
            <p className="sub" style={{ margin: 0 }}>
              {group.knownAs && <>Known as {group.knownAs} · </>}
              {group.kind.replace(/_/g, ' ').toLowerCase()} · {group.county}
            </p>
          </div>
          {group.registrationNo ? (
            <span className="pill p-ok">
              <Icon name="check" size={12} />{group.registrationNo}
            </span>
          ) : (
            <span className="pill p-warn">Not registered</span>
          )}
        </div>

        {missingOffices.length > 0 && (
          <p className="pill p-warn" style={{ padding: '10px 13px', marginBottom: 16 }}>
            <Icon name="alert-circle" size={14} />
            No {missingOffices.map((o) => (ROLE_LABEL[o] ?? o).toLowerCase()).join(' or ')} recorded.
            A group needs office-bearers before it can vote on a loan.
          </p>
        )}

        <div className="ctl">
          <span className="sub" style={{ marginRight: 'auto' }}>
            {group.members.length} active · {officeHolders.length} office-bearers
          </span>
          {canEdit && (
            <button className="btn btn-p btn-sm" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} />Add member
            </button>
          )}
        </div>

        {group.members.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="users" size={22} /></span>
            <h3>No members yet</h3>
            <p style={{ margin: 0 }}>Add the office-bearers first.</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Member</th><th>Role</th><th>Joined</th><th /></tr>
            </thead>
            <tbody>
              {group.members.map((m) => (
                <tr key={m.membershipId}>
                  <td><strong>{m.name}</strong></td>
                  <td>
                    {canEdit ? (
                      <select className="inp" style={{ minHeight: 34, padding: '5px 9px', fontSize: '.84rem' }}
                        value={m.role} aria-label={`Role for ${m.name}`}
                        onChange={(e) => changeRole(m, e.target.value as Role)} disabled={pending}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : (
                      <span className={`pill ${OFFICE.has(m.role) ? 'p-info' : 'p-mute'}`}>
                        {ROLE_LABEL[m.role] ?? m.role}
                      </span>
                    )}
                  </td>
                  <td className="mono sub" style={{ fontSize: '.79rem' }}>{m.joinedAt.slice(0, 10)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {canEdit && (
                      <button className="btn btn-o btn-sm" onClick={() => setRemoving(m)}>
                        <Icon name="close" size={13} />Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {error && (
          <p className="pill p-bad" style={{ marginTop: 14, padding: '10px 13px' }} role="alert">
            <Icon name="alert-circle" size={14} />{error}
          </p>
        )}
      </div>

      {adding && <AddMember group={group} onClose={() => setAdding(false)} />}

      {removing && (
        <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="rm-title"
          onClick={(e) => { if (e.target === e.currentTarget) setRemoving(null); }}>
          <div className="modal narrow">
            <div className="modal-hd">
              <h2 id="rm-title">Remove {removing.name}?</h2>
              <button className="x" onClick={() => setRemoving(null)} aria-label="Close">
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="modal-bd">
              <p className="sub" style={{ marginBottom: 14 }}>
                This is a soft exit. {removing.name} keeps their contribution history and can be
                reinstated later — a group's books must stay true.
              </p>
              <label className="sub" htmlFor="rm-reason" style={{ display: 'block', marginBottom: 6 }}>
                Reason (required, recorded in the audit log)
              </label>
              <textarea id="rm-reason" className="inp" rows={2} style={{ width: '100%' }}
                value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Left the group at the March meeting" />
            </div>
            <div className="modal-ft">
              <button className="btn btn-o" onClick={() => setRemoving(null)}>Cancel</button>
              <button className="btn btn-d" onClick={remove} disabled={pending || !reason.trim()}>
                Remove from group
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AddMember({ group, onClose }: { group: Group; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; name: string; official: string; county: string }[]>([]);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [role, setRole] = useState<Role>('MEMBER');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const announce = useAnnounce();

  function search(v: string) {
    setQ(v);
    clearTimeout(timer.current);
    if (v.trim().length < 2) { setHits([]); return; }
    timer.current = setTimeout(async () => {
      const res = await actionSearchPeople(group.id, v);
      setHits(res);
      announce(res.length ? `${res.length} people found` : 'Nobody found');
    }, 200);
  }

  function add() {
    if (!picked) return;
    start(async () => {
      const r = await actionAddMember(group.id, picked.id, role);
      if (r.ok) { announce(`${picked.name} added to ${group.name}`, 'assertive'); onClose(); }
      else setError(r.error);
    });
  }

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="am-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal narrow">
        <div className="modal-hd">
          <h2 id="am-title">Add someone to {group.name}</h2>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-bd">
          <p className="sub" style={{ marginBottom: 14 }}>
            Search people already on Esoko. Someone who has not joined yet needs a registration
            first.
          </p>

          <div className="srch" style={{ marginBottom: 12 }}>
            <span className="mg"><Icon name="search" size={16} /></span>
            <input className="inp" value={q} onChange={(e) => search(e.target.value)}
              aria-label="Search people" aria-expanded={hits.length > 0}
              placeholder="Name or phone number…" />
          </div>

          {hits.length > 0 && (
            <div role="listbox" aria-label="Search results" style={{ marginBottom: 14 }}>
              {hits.map((h) => (
                <button key={h.id} role="option" aria-selected={picked?.id === h.id}
                  onClick={() => { setPicked({ id: h.id, name: h.name }); setQ(h.name); setHits([]); }}
                  style={{
                    display: 'flex', width: '100%', textAlign: 'left', gap: 10,
                    padding: '11px 13px', border: '1px solid var(--line)', borderRadius: 8,
                    marginBottom: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  <span style={{ flex: 1 }}>
                    <strong style={{ fontSize: '.9rem' }}>{h.name}</strong>
                    <span className="sub" style={{ display: 'block', fontSize: '.79rem' }}>
                      {h.official} · {h.county}
                    </span>
                  </span>
                  <span className="pill p-ok">Select</span>
                </button>
              ))}
            </div>
          )}

          {picked && (
            <>
              <p className="pill p-ok" style={{ padding: '10px 13px', marginBottom: 14 }}>
                <Icon name="check-circle" size={14} />Adding {picked.name}
              </p>
              <label className="sub" htmlFor="am-role" style={{ display: 'block', marginBottom: 6 }}>
                Role in the group
              </label>
              <select id="am-role" className="inp" style={{ width: '100%' }} value={role}
                onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </>
          )}

          {error && (
            <p className="pill p-bad" style={{ marginTop: 14, padding: '10px 13px' }} role="alert">
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>
        <div className="modal-ft">
          <button className="btn btn-o" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" onClick={add} disabled={pending || !picked}>
            <Icon name="plus" size={15} />Add to group
          </button>
        </div>
      </div>
    </div>
  );
}
