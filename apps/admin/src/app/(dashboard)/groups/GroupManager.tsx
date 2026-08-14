'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Icon, type IconName } from '@esoko/ui';
import { formatMsisdn } from '@esoko/domain';
import { useAnnounce } from '@esoko/a11y';
import {
  actionSearchPeople, actionAddMember, actionAddNewMember, actionUpdateMemberPhone,
  actionSetRole, actionRemoveMember,
  actionUploadGroupDocument, actionListGroupDocuments, actionCreateGroup,
} from './actions';

type Role = 'CHAIRPERSON' | 'TREASURER' | 'SECRETARY' | 'MEMBER' | 'OTHER';

interface Member {
  membershipId: string; partyId: string; name: string; knownAs?: string | null;
  phone?: string | null; role: Role | string; customRole?: string | null; joinedAt: string;
}
interface Group {
  id: string; name: string; knownAs: string | null; kind: string;
  county: string; registrationNo: string | null; members: Member[];
}
interface GroupDoc {
  id: string; title: string; kind: string; mimeType: string; sizeBytes: number; uploadedAt: string;
}

const ROLES: Role[] = ['CHAIRPERSON', 'TREASURER', 'SECRETARY', 'MEMBER', 'OTHER'];
const ROLE_LABEL: Record<string, string> = {
  CHAIRPERSON: 'Chairperson', TREASURER: 'Treasurer', SECRETARY: 'Secretary', MEMBER: 'Member',
  OTHER: 'Other…',
};
const OFFICE = new Set(['CHAIRPERSON', 'TREASURER', 'SECRETARY']);

/** What to actually show for a member's role — their own wording when
 *  it's a custom one, the fixed label otherwise. */
function roleText(role: string, customRole?: string | null) {
  if (role === 'OTHER') return customRole?.trim() || 'Other';
  return ROLE_LABEL[role] ?? role;
}

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function typeIcon(mime: string): IconName {
  if (mime.startsWith('image/')) return 'certificate';
  if (mime === 'application/pdf') return 'document';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'grid';
  return 'document';
}

/** Buckets documents into folders by kind, preserving first-seen order. */
function byKind<T extends { kind: string }>(docs: T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const d of docs) m.set(d.kind, [...(m.get(d.kind) ?? []), d]);
  return [...m.entries()];
}

export function GroupManager({
  groups, canEdit, canUploadDocs, canCreate, documentKinds, groupKinds, counties,
}: {
  groups: Group[]; canEdit: boolean; canUploadDocs: boolean; canCreate: boolean;
  documentKinds: [string, string][]; groupKinds: [string, string][]; counties: string[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState<string | null>(groups[0]?.id ?? null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const pendingSelectRef = useRef<string | null>(null);

  useEffect(() => {
    if (pendingSelectRef.current && groups.some((g) => g.id === pendingSelectRef.current)) {
      setSel(pendingSelectRef.current);
      pendingSelectRef.current = null;
    }
  }, [groups]);

  const view = groups.filter((g) =>
    !q || `${g.name} ${g.knownAs ?? ''} ${g.county}`.toLowerCase().includes(q.toLowerCase()));
  const current = groups.find((g) => g.id === sel);

  return (
    <div className="groups-layout">
      <div className="card group-list-card" style={{ padding: 0 }}>
        <div style={{ padding: 14, borderBottom: '1px solid var(--line)', display: 'flex', gap: 8 }}>
          <div className="srch" style={{ flex: 1 }}>
            <span className="mg"><Icon name="search" size={16} /></span>
            <input className="inp" value={q} onChange={(e) => setQ(e.target.value)}
              aria-label="Search groups" placeholder="Search groups…" />
          </div>
          {canCreate && (
            <button className="btn btn-p btn-sm" onClick={() => setCreating(true)} aria-label="Register a new group">
              <Icon name="plus" size={14} />New
            </button>
          )}
        </div>

        {view.length === 0 ? (
          <div className="empty" style={{ padding: 30 }}>
            <span className="ico"><Icon name="handshake" size={20} /></span>
            <h3>No groups yet</h3>
            <p style={{ margin: 0, fontSize: '.88rem' }}>
              {canCreate
                ? 'Register one, or a group appears here when someone joins as one.'
                : 'A group appears here when someone registers one during joining.'}
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
        <GroupDetail
          group={current} canEdit={canEdit}
          canUploadDocs={canUploadDocs} documentKinds={documentKinds}
        />
      ) : (
        <div className="card"><div className="empty"><p>Select a group.</p></div></div>
      )}

      {creating && (
        <CreateGroup
          groupKinds={groupKinds}
          counties={counties}
          onClose={() => setCreating(false)}
          onCreated={(partyId) => {
            pendingSelectRef.current = partyId;
            setCreating(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateGroup({
  groupKinds, counties, onClose, onCreated,
}: {
  groupKinds: [string, string][]; counties: string[];
  onClose: () => void; onCreated: (partyId: string) => void;
}) {
  const [kind, setKind] = useState(groupKinds[0]?.[0] ?? 'CHAMA');
  const [officialName, setOfficialName] = useState('');
  const [knownAs, setKnownAs] = useState('');
  const [county, setCounty] = useState(counties[0] ?? '');
  const [registrationNo, setRegistrationNo] = useState('');
  const [memberCount, setMemberCount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function create() {
    if (!officialName.trim() || !county) return;
    setError(null);
    start(async () => {
      const r = await actionCreateGroup({
        kind: kind as never,
        officialName,
        knownAs: knownAs || undefined,
        county,
        registrationNo: registrationNo || undefined,
        memberCount: memberCount ? Number(memberCount) : undefined,
      });
      if (r.ok) { announce(`${officialName} registered`, 'assertive'); onCreated(r.partyId); }
      else setError(r.error);
    });
  }

  return (
    <div className="scrim" role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="cg-title">
        <div className="modal-hd">
          <h2 id="cg-title">Register a new group</h2>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-bd">
          <label className="sub" htmlFor="cg-name" style={{ display: 'block', marginBottom: 6 }}>
            Official name
          </label>
          <input id="cg-name" className="inp" style={{ width: '100%', marginBottom: 12 }}
            value={officialName} onChange={(e) => setOfficialName(e.target.value)}
            placeholder="As it appears on the constitution or registration" />

          <label className="sub" htmlFor="cg-known" style={{ display: 'block', marginBottom: 6 }}>
            Known as — optional
          </label>
          <input id="cg-known" className="inp" style={{ width: '100%', marginBottom: 12 }}
            value={knownAs} onChange={(e) => setKnownAs(e.target.value)}
            placeholder="What members actually call it" />

          <label className="sub" htmlFor="cg-kind" style={{ display: 'block', marginBottom: 6 }}>
            Kind
          </label>
          <select id="cg-kind" className="inp" style={{ width: '100%', marginBottom: 12 }}
            value={kind} onChange={(e) => setKind(e.target.value)}>
            {groupKinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>

          <label className="sub" htmlFor="cg-county" style={{ display: 'block', marginBottom: 6 }}>
            County
          </label>
          <select id="cg-county" className="inp" style={{ width: '100%', marginBottom: 12 }}
            value={county} onChange={(e) => setCounty(e.target.value)}>
            {counties.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <label className="sub" htmlFor="cg-regno" style={{ display: 'block', marginBottom: 6 }}>
            Registration number — optional
          </label>
          <input id="cg-regno" className="inp" style={{ width: '100%', marginBottom: 12 }}
            value={registrationNo} onChange={(e) => setRegistrationNo(e.target.value)}
            placeholder="If already registered with the Ministry" />

          <label className="sub" htmlFor="cg-members" style={{ display: 'block', marginBottom: 6 }}>
            Member count — optional, as declared
          </label>
          <input id="cg-members" className="inp" type="number" min={0} style={{ width: '100%' }}
            value={memberCount} onChange={(e) => setMemberCount(e.target.value)}
            placeholder="Add real members individually after — this is just a headline figure" />

          {error && (
            <p className="pill p-bad" style={{ marginTop: 14, padding: '10px 13px', whiteSpace: 'normal' }} role="alert">
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>
        <div className="modal-ft">
          <button className="btn btn-o" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" onClick={create} disabled={pending || !officialName.trim() || !county}>
            <Icon name="plus" size={15} />{pending ? 'Registering…' : 'Register group'}
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupDetail({
  group, canEdit, canUploadDocs, documentKinds,
}: {
  group: Group; canEdit: boolean; canUploadDocs: boolean; documentKinds: [string, string][];
}) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  const [docs, setDocs] = useState<GroupDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [previewing, setPreviewing] = useState<GroupDoc | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDocsLoading(true);
    actionListGroupDocuments(group.id).then((rows) => {
      if (!cancelled) { setDocs(rows); setDocsLoading(false); }
    });
    return () => { cancelled = true; };
  }, [group.id]);

  const officeHolders = group.members.filter((m) => OFFICE.has(m.role));
  const missingOffices = ROLES.slice(0, 3).filter(
    (r) => !group.members.some((m) => m.role === r));

  function changeRole(m: Member, role: Role, customRole?: string) {
    start(async () => {
      const r = await actionSetRole(m.membershipId, role, customRole);
      if (r.ok) announce(`${m.name} is now ${roleText(role, customRole)}`, 'assertive');
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
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 18, flexWrap: 'wrap' }}>
          <span style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--blue-t)', color: 'var(--blue)', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <Icon name="handshake" size={21} />
          </span>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
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
          <Link className="btn btn-o btn-sm" href={`/groups/${group.id}` as Route}>
            <Icon name="chart" size={13} />Full analytics
          </Link>
        </div>

        {missingOffices.length > 0 && (
          <p className="pill p-warn" style={{ padding: '10px 13px', marginBottom: 16, whiteSpace: 'normal' }}>
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
                  <td>
                    <strong>{m.name}</strong>
                    {m.knownAs && <span className="sub" style={{ display: 'block', fontSize: '.79rem' }}>Known as {m.knownAs}</span>}
                    <span style={{ display: 'block', marginTop: 3 }}>
                      <PhoneCell member={m} canEdit={canEdit} pending={pending} />
                    </span>
                  </td>
                  <td>
                    {canEdit ? (
                      <MemberRoleCell member={m} pending={pending} onChange={changeRole} />
                    ) : (
                      <span className={`pill ${OFFICE.has(m.role) ? 'p-info' : 'p-mute'}`}>
                        {roleText(m.role, m.customRole)}
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
          <p className="pill p-bad" style={{ marginTop: 14, padding: '10px 13px', whiteSpace: 'normal' }} role="alert">
            <Icon name="alert-circle" size={14} />{error}
          </p>
        )}
      </div>

      <div className="card">
        <div className="ctl">
          <h2 style={{ marginRight: 'auto' }}><Icon name="document" size={18} />Documents</h2>
          {canUploadDocs && (
            <button className="btn btn-p btn-sm" onClick={() => setUploading(true)}>
              <Icon name="plus" size={14} />Upload document
            </button>
          )}
        </div>

        {docsLoading ? (
          <p className="sub" style={{ padding: '10px 0' }}>Loading…</p>
        ) : docs.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="document" size={22} /></span>
            <h3>No documents yet</h3>
            <p style={{ margin: 0 }}>Constitution, member list, registration certificate — whatever this group has on file.</p>
          </div>
        ) : (
          byKind(docs).map(([kind, kindDocs]) => (
            <details key={kind} open={byKind(docs).length === 1} style={{ marginBottom: 8 }}>
              <summary style={{ cursor: 'pointer', padding: '8px 0', fontWeight: 600 }}>
                <Icon name="box" size={14} />{' '}
                {documentKinds.find(([k]) => k === kind)?.[1] ?? kind}{' '}
                <span className="sub">({kindDocs.length})</span>
              </summary>
              <table className="tbl">
                <thead>
                  <tr><th>Title</th><th>Size</th><th>Uploaded</th><th /></tr>
                </thead>
                <tbody>
                  {kindDocs.map((d) => (
                    <tr key={d.id}>
                      <td><strong>{d.title}</strong></td>
                      <td className="mono sub" style={{ fontSize: '.79rem' }}>{humanSize(d.sizeBytes)}</td>
                      <td className="mono sub" style={{ fontSize: '.79rem' }}>{d.uploadedAt.slice(0, 10)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-o btn-sm" onClick={() => setPreviewing(d)}>
                          <Icon name="eye" size={13} />View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))
        )}
      </div>

      {adding && <AddMember group={group} onClose={() => setAdding(false)} />}

      {previewing && (
        <DocPreview doc={previewing} kindLabel={documentKinds.find(([k]) => k === previewing.kind)?.[1] ?? previewing.kind}
          onClose={() => setPreviewing(null)} />
      )}

      {uploading && (
        <UploadDocument
          group={group}
          documentKinds={documentKinds}
          onClose={() => setUploading(false)}
          onUploaded={(doc) => {
            setDocs((prev) => [{ ...doc, uploadedAt: new Date().toISOString() }, ...prev]);
            setUploading(false);
          }}
        />
      )}

      {removing && (
        <div className="scrim" role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget) setRemoving(null); }}>
          <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="rm-title">
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

/**
 * The role dropdown for one member. A fixed role saves the moment it's
 * picked, same as before — "Other" needs a word first, so it holds off
 * and shows a text box + explicit Save instead of firing on every
 * keystroke.
 */
function MemberRoleCell({
  member, pending, onChange,
}: { member: Member; pending: boolean; onChange: (m: Member, role: Role, customRole?: string) => void }) {
  const [role, setRole] = useState<Role>((member.role as Role) ?? 'MEMBER');
  const [customRole, setCustomRole] = useState(member.role === 'OTHER' ? (member.customRole ?? '') : '');
  const showCustomField = role === 'OTHER';
  const dirty = role === 'OTHER' && customRole.trim() !== (member.customRole ?? '').trim();

  function pick(next: Role) {
    setRole(next);
    if (next !== 'OTHER') onChange(member, next);
  }

  function saveCustom() {
    if (!customRole.trim()) return;
    onChange(member, 'OTHER', customRole);
  }

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <select className="inp" style={{ minHeight: 34, padding: '5px 9px', fontSize: '.84rem' }}
        value={role} aria-label={`Role for ${member.name}`}
        onChange={(e) => pick(e.target.value as Role)} disabled={pending}>
        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      </select>
      {showCustomField && (
        <>
          <input className="inp" style={{ minHeight: 34, padding: '5px 9px', fontSize: '.84rem', width: 130 }}
            value={customRole} onChange={(e) => setCustomRole(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveCustom(); }}
            placeholder="e.g. Youth rep" aria-label={`Custom role for ${member.name}`} disabled={pending} />
          {dirty && (
            <button className="btn btn-p btn-sm" style={{ minHeight: 34, padding: '5px 10px' }}
              onClick={saveCustom} disabled={pending || !customRole.trim()}>
              Save
            </button>
          )}
        </>
      )}
    </div>
  );
}

function showPhone(p: string): string {
  return /^\+254\d{9}$/.test(p) ? formatMsisdn(p) : p;
}

/** A member's phone with an inline "fix" affordance. A wrong or missing
 *  number strands the member (they can't verify it, set a PIN or sign in),
 *  so staff can correct it here — the number is normalised on the server. */
function PhoneCell({
  member, canEdit, pending,
}: {
  member: Member; canEdit: boolean; pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(member.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const announce = useAnnounce();

  useEffect(() => { setValue(member.phone ?? ''); }, [member.phone]);
  const canSave = /^0?7\d{8}$|^\+?2547\d{8}$|^17\d{8}$|^2547\d{8}$/.test(value.trim());

  function save() {
    if (!value.trim() || saving) return;
    setError(null);
    start(async () => {
      const r = await actionUpdateMemberPhone(member.membershipId, value);
      if (r.ok) { announce(`Phone updated for ${member.name}`, 'assertive'); setEditing(false); }
      else setError(r.error);
    });
  }

  if (editing) {
    return (
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <label className="visually-hidden" htmlFor={`phone-${member.membershipId}`}>
          Phone number for {member.name}
        </label>
        <input id={`phone-${member.membershipId}`} className="inp mono"
          style={{ minHeight: 34, padding: '5px 9px', fontSize: '.82rem', width: 150 }}
          value={value} onChange={(e) => { setValue(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder="07XX XXX XXX" autoComplete="off" disabled={saving} />
        <button className="btn btn-p btn-sm" style={{ minHeight: 34, padding: '5px 10px' }}
          onClick={save} disabled={saving || !canSave}>Save</button>
        <button className="btn btn-o btn-sm" style={{ minHeight: 34, padding: '5px 10px' }}
          onClick={() => { setEditing(false); setError(null); setValue(member.phone ?? ''); }} disabled={saving}>
          Cancel
        </button>
        {error && <span className="sub" role="alert" style={{ flexBasis: '100%', fontSize: '.79rem' }}>{error}</span>}
      </span>
    );
  }

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className="mono sub" style={{ fontSize: '.8rem' }}>
        {member.phone ? showPhone(member.phone) : 'No phone on file'}
        {member.phone && !/^\+254\d{9}$/.test(member.phone) && (
          <span className="pill p-warn" style={{ marginLeft: 5 }}>invalid</span>
        )}
      </span>
      {canEdit && (
        <button className="btn btn-o btn-sm" style={{ minHeight: 34, padding: '4px 9px' }}
          onClick={() => setEditing(true)} disabled={pending} aria-label={`Fix phone for ${member.name}`}>
          Fix phone
        </button>
      )}
    </span>
  );
}

function AddMember({ group, onClose }: { group: Group; onClose: () => void }) {
  const [mode, setMode] = useState<'search' | 'new'>('search');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; name: string; official: string; county: string }[]>([]);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [role, setRole] = useState<Role>('MEMBER');
  const [customRole, setCustomRole] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const announce = useAnnounce();

  function search(v: string) {
    setQ(v);
    setPicked(null);
    clearTimeout(timer.current);
    if (v.trim().length < 2) { setHits([]); setSearching(false); setSearched(false); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const res = await actionSearchPeople(group.id, v);
      setHits(res);
      setSearching(false);
      setSearched(true);
      announce(res.length ? `${res.length} people found` : 'Nobody found');
    }, 200);
  }

  function add() {
    if (!picked) return;
    if (role === 'OTHER' && !customRole.trim()) return;
    start(async () => {
      const r = await actionAddMember(group.id, picked.id, role, role === 'OTHER' ? customRole : undefined);
      if (r.ok) { announce(`${picked.name} added to ${group.name}`, 'assertive'); onClose(); }
      else setError(r.error);
    });
  }

  function addNew() {
    if (!newName.trim()) return;
    if (role === 'OTHER' && !customRole.trim()) return;
    start(async () => {
      const r = await actionAddNewMember(
        group.id, newName, newPhone, role, role === 'OTHER' ? customRole : undefined);
      if (r.ok) { announce(`${newName} added to ${group.name}`, 'assertive'); onClose(); }
      else setError(r.error);
    });
  }

  const roleReady = role !== 'OTHER' || Boolean(customRole.trim());
  const canSubmit = (mode === 'search' ? Boolean(picked) : Boolean(newName.trim())) && roleReady;

  return (
    <div className="scrim" role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="am-title">
        <div className="modal-hd">
          <h2 id="am-title">Add someone to {group.name}</h2>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-bd">
          <div role="tablist" aria-label="How to add them" className="ctl" style={{ marginBottom: 14 }}>
            <button type="button" role="tab" aria-selected={mode === 'search'}
              className={`btn btn-sm ${mode === 'search' ? 'btn-p' : 'btn-o'}`}
              onClick={() => { setMode('search'); setError(null); }}>
              <Icon name="search" size={13} />Search existing
            </button>
            <button type="button" role="tab" aria-selected={mode === 'new'}
              className={`btn btn-sm ${mode === 'new' ? 'btn-p' : 'btn-o'}`}
              onClick={() => { setMode('new'); setError(null); }}>
              <Icon name="plus" size={13} />Type a new member
            </button>
          </div>

          {mode === 'search' ? (
            <>
              <p className="sub" style={{ marginBottom: 14 }}>
                Search people already on Esoko.
              </p>

              <div className="srch" style={{ marginBottom: 12 }}>
                <span className="mg"><Icon name="search" size={16} /></span>
                <input className="inp" value={q} onChange={(e) => search(e.target.value)}
                  role="combobox" aria-label="Search people" aria-expanded={hits.length > 0}
                  aria-controls="member-hits"
                  placeholder="Name or phone number…" />
              </div>

              {searching && (
                <p className="sub" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="spinner" aria-hidden="true" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  Searching…
                </p>
              )}

              {!searching && hits.length > 0 && (
                <div id="member-hits" role="listbox" aria-label="Search results" style={{ marginBottom: 14 }}>
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

              {!searching && searched && hits.length === 0 && q.trim().length >= 2 && !picked && (
                <p className="pill p-warn" style={{ padding: '10px 13px', marginBottom: 14, whiteSpace: 'normal' }}>
                  <Icon name="alert-circle" size={14} />
                  No one matches &ldquo;{q}&rdquo; — they may already be in this group, or try{' '}
                  <button type="button" onClick={() => { setMode('new'); setError(null); }}
                    style={{ background: 'none', border: 0, padding: 0, textDecoration: 'underline', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                    typing them as a new member
                  </button>.
                </p>
              )}

              {q.trim().length === 1 && (
                <p className="sub" style={{ marginBottom: 14 }}>Keep typing — at least 2 characters.</p>
              )}

              {picked && (
                <p className="pill p-ok" style={{ padding: '10px 13px', marginBottom: 14 }}>
                  <Icon name="check-circle" size={14} />Adding {picked.name}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="sub" style={{ marginBottom: 14 }}>
                For someone not on Esoko yet — a name is enough to add them as a member. Phone is
                optional; without one they can't log in, dial in or get SMS until it's added later.
              </p>

              <label className="sub" htmlFor="am-new-name" style={{ display: 'block', marginBottom: 6 }}>
                Name
              </label>
              <input id="am-new-name" className="inp" style={{ width: '100%', marginBottom: 12 }}
                value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="As they're known in the group" />

              <label className="sub" htmlFor="am-new-phone" style={{ display: 'block', marginBottom: 6 }}>
                Phone number — optional
              </label>
              <input id="am-new-phone" className="inp" style={{ width: '100%', marginBottom: 12 }}
                value={newPhone} onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+254 7…" />
            </>
          )}

          <label className="sub" htmlFor="am-role" style={{ display: 'block', marginBottom: 6 }}>
            Role in the group
          </label>
          <select id="am-role" className="inp" style={{ width: '100%', marginBottom: role === 'OTHER' ? 12 : 0 }}
            value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>

          {role === 'OTHER' && (
            <>
              <label className="sub" htmlFor="am-custom-role" style={{ display: 'block', marginBottom: 6 }}>
                What's this role called?
              </label>
              <input id="am-custom-role" className="inp" style={{ width: '100%' }}
                value={customRole} onChange={(e) => setCustomRole(e.target.value)}
                placeholder="e.g. Youth rep, Auditor" />
            </>
          )}

          {error && (
            <p className="pill p-bad" style={{ marginTop: 14, padding: '10px 13px', whiteSpace: 'normal' }} role="alert">
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>
        <div className="modal-ft">
          <button className="btn btn-o" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" onClick={mode === 'search' ? add : addNew} disabled={pending || !canSubmit}>
            <Icon name="plus" size={15} />Add to group
          </button>
        </div>
      </div>
    </div>
  );
}

function UploadDocument({
  group, documentKinds, onClose, onUploaded,
}: {
  group: Group;
  documentKinds: [string, string][];
  onClose: () => void;
  onUploaded: (doc: { id: string; title: string; kind: string; mimeType: string; sizeBytes: number }) => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState(documentKinds[0]?.[0] ?? 'OTHER');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function upload() {
    if (!file || !title.trim()) return;
    setError(null);
    start(async () => {
      const form = new FormData();
      form.set('partyId', group.id);
      form.set('title', title);
      form.set('kind', kind);
      form.set('file', file);
      const r = await actionUploadGroupDocument(form);
      if (r.ok) {
        announce(`${r.doc.title} uploaded`, 'assertive');
        onUploaded(r.doc);
      } else setError(r.error);
    });
  }

  return (
    <div className="scrim" role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="ud-title">
        <div className="modal-hd">
          <h2 id="ud-title">Upload document for {group.name}</h2>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-bd">
          <label className="sub" htmlFor="ud-title-input" style={{ display: 'block', marginBottom: 6 }}>
            Title
          </label>
          <input id="ud-title-input" className="inp" style={{ width: '100%', marginBottom: 12 }}
            value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Group constitution, signed 2024" />

          <label className="sub" htmlFor="ud-kind" style={{ display: 'block', marginBottom: 6 }}>
            Kind
          </label>
          <select id="ud-kind" className="inp" style={{ width: '100%', marginBottom: 12 }}
            value={kind} onChange={(e) => setKind(e.target.value)}>
            {documentKinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>

          <label className="sub" htmlFor="ud-file" style={{ display: 'block', marginBottom: 6 }}>
            File (PDF, Word, Excel or image — up to 10 MB)
          </label>
          <input id="ud-file" className="inp" type="file" style={{ width: '100%' }}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />

          {error && (
            <p className="pill p-bad" style={{ marginTop: 14, padding: '10px 13px', whiteSpace: 'normal' }} role="alert">
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>
        <div className="modal-ft">
          <button className="btn btn-o" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" onClick={upload} disabled={pending || !file || !title.trim()}>
            <Icon name="plus" size={15} />{pending ? 'Uploading…' : 'Upload and save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DocPreview({
  doc, kindLabel, onClose,
}: { doc: GroupDoc; kindLabel: string; onClose: () => void }) {
  const isImage = doc.mimeType.startsWith('image/');
  const isPdf = doc.mimeType === 'application/pdf';
  const previewable = isImage || isPdf;

  return (
    <div className="scrim" role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dp-title">
        <div className="modal-hd">
          <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--blue-t)', color: 'var(--blue)', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <Icon name={typeIcon(doc.mimeType)} size={19} />
          </span>
          <div>
            <h2 id="dp-title">{doc.title}</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              {kindLabel} · {humanSize(doc.sizeBytes)} · uploaded{' '}
              {new Date(doc.uploadedAt).toLocaleDateString('en-KE')}
            </p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

        <div className="modal-bd">
          <div className="preview" style={{ marginBottom: 20 }}>
            {isImage && <img src={`/api/documents/${doc.id}?inline=1`} alt={doc.title} />}
            {isPdf && (
              <iframe src={`/api/documents/${doc.id}?inline=1`} title={`Preview of ${doc.title}`} />
            )}
            {!previewable && (
              <div style={{ textAlign: 'center', padding: 30 }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 52, height: 52, borderRadius: 13, background: '#fff', margin: '0 auto 14px', color: 'var(--tx-3)' }}>
                  <Icon name={typeIcon(doc.mimeType)} size={24} />
                </span>
                <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{doc.title}</p>
                <p className="sub" style={{ margin: '0 0 16px' }}>
                  Word and Excel files cannot be previewed in the browser.
                </p>
                <a className="btn btn-o btn-sm" href={`/api/documents/${doc.id}`} download>
                  <Icon name="download" size={14} />Download to view
                </a>
              </div>
            )}
          </div>
        </div>

        <div className="modal-ft">
          <a className="btn btn-o btn-sm" style={{ marginRight: 'auto' }}
            href={`/api/documents/${doc.id}`} download>
            <Icon name="download" size={14} />Download
          </a>
          <button className="btn btn-o" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
