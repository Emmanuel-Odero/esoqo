'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon, type IconName } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import {
  actionSearchPeople, actionAddMember, actionSetRole, actionRemoveMember,
  actionUploadGroupDocument, actionListGroupDocuments,
} from './actions';

type Role = 'CHAIRPERSON' | 'TREASURER' | 'SECRETARY' | 'MEMBER';

interface Member {
  membershipId: string; partyId: string; name: string; role: Role | string; joinedAt: string;
}
interface Group {
  id: string; name: string; knownAs: string | null; kind: string;
  county: string; registrationNo: string | null; members: Member[];
}
interface GroupDoc {
  id: string; title: string; kind: string; mimeType: string; sizeBytes: number; uploadedAt: string;
}

const ROLES: Role[] = ['CHAIRPERSON', 'TREASURER', 'SECRETARY', 'MEMBER'];
const ROLE_LABEL: Record<string, string> = {
  CHAIRPERSON: 'Chairperson', TREASURER: 'Treasurer', SECRETARY: 'Secretary', MEMBER: 'Member',
};
const OFFICE = new Set(['CHAIRPERSON', 'TREASURER', 'SECRETARY']);

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
  groups, canEdit, canUploadDocs, documentKinds,
}: {
  groups: Group[]; canEdit: boolean; canUploadDocs: boolean; documentKinds: [string, string][];
}) {
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
        <GroupDetail
          group={current} canEdit={canEdit}
          canUploadDocs={canUploadDocs} documentKinds={documentKinds}
        />
      ) : (
        <div className="card"><div className="empty"><p>Select a group.</p></div></div>
      )}
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
          <Link className="btn btn-o btn-sm" href={`/groups/${group.id}` as Route}>
            <Icon name="chart" size={13} />Full analytics
          </Link>
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
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="ud-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal narrow">
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
            <p className="pill p-bad" style={{ marginTop: 14, padding: '10px 13px' }} role="alert">
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
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="dp-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
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
