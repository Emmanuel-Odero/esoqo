'use client';

import { useState, useTransition } from 'react';
import { Icon, type IconName } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionReview, actionUpdate, actionDelete } from './actions';

interface Doc {
  id: string; title: string; kind: string; mimeType: string; sizeBytes: number;
  status: string; uploadedAt: string; owner: string; originalName: string;
}

const STATUS: Record<string, [string, string]> = {
  PENDING_REVIEW: ['p-warn', 'Awaiting review'],
  ACCEPTED: ['p-ok', 'Accepted'],
  REJECTED: ['p-bad', 'Rejected'],
  SUPERSEDED: ['p-mute', 'Superseded'],
};

function typeIcon(mime: string): IconName {
  if (mime.startsWith('image/')) return 'certificate';
  if (mime === 'application/pdf') return 'document';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'grid';
  return 'document';
}

function human(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** Buckets documents into folders by kind, preserving first-seen order. */
function byKind<T extends { kind: string }>(docs: T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const d of docs) m.set(d.kind, [...(m.get(d.kind) ?? []), d]);
  return [...m.entries()];
}

export function DocumentGrid({
  docs, kinds, canReview, canDelete,
}: {
  docs: Doc[]; kinds: [string, string][]; canReview: boolean; canDelete: boolean;
}) {
  const [open, setOpen] = useState<Doc | null>(null);
  const [q, setQ] = useState('');

  const view = docs.filter((d) =>
    !q || `${d.title} ${d.owner} ${d.originalName}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="ctl">
        <div className="srch">
          <span className="mg"><Icon name="search" size={16} /></span>
          <input className="inp" value={q} onChange={(e) => setQ(e.target.value)}
            aria-label="Search documents" placeholder="Title, person or filename…" />
        </div>
        <span className="sub">{view.length} shown</span>
      </div>

      {view.length === 0 ? (
        <div className="card">
          <div className="empty">
            <span className="ico"><Icon name="document" size={22} /></span>
            <h3>No documents yet</h3>
            <p style={{ margin: 0 }}>
              Files uploaded during registration appear here for review.
            </p>
          </div>
        </div>
      ) : (
        byKind(view).map(([kind, kindDocs]) => (
          <details key={kind} open style={{ marginBottom: 18 }}>
            <summary style={{ cursor: 'pointer', padding: '8px 0', fontWeight: 600 }}>
              <Icon name="box" size={14} />{' '}
              {kinds.find(([k]) => k === kind)?.[1] ?? kind}{' '}
              <span className="sub">({kindDocs.length})</span>
            </summary>
            <div className="dgrid">
              {kindDocs.map((d) => {
                const [cls, label] = STATUS[d.status] ?? ['p-mute', d.status];
                const isImage = d.mimeType.startsWith('image/');
                return (
                  <button className="dcard" key={d.id} onClick={() => setOpen(d)}
                    aria-label={`Open ${d.title}`}>
                    <div className="thumb">
                      {isImage
                        ? <img src={`/api/documents/${d.id}?inline=1`} alt="" loading="lazy" />
                        : <Icon name={typeIcon(d.mimeType)} size={30} />}
                    </div>
                    <div className="meta">
                      <span className="t">{d.title}</span>
                      <span className="sub" style={{ display: 'block', fontSize: '.79rem', margin: '2px 0 8px' }}>
                        {d.owner} · {human(d.sizeBytes)}
                      </span>
                      <span className={`pill ${cls}`}>{label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </details>
        ))
      )}

      {open && (
        <DocModal doc={open} kinds={kinds} canReview={canReview} canDelete={canDelete}
          onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function DocModal({
  doc, kinds, canReview, canDelete, onClose,
}: { doc: Doc; kinds: [string, string][]; canReview: boolean; canDelete: boolean; onClose: () => void }) {
  const [title, setTitle] = useState(doc.title);
  const [kind, setKind] = useState(doc.kind);
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  const isImage = doc.mimeType.startsWith('image/');
  const isPdf = doc.mimeType === 'application/pdf';
  const previewable = isImage || isPdf;
  const dirty = title !== doc.title || kind !== doc.kind;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) { announce(msg, 'assertive'); onClose(); }
      else { setError(r.error ?? 'That did not work'); announce(r.error ?? '', 'assertive'); }
    });

  return (
    <div className="scrim" role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dm-title">
        <div className="modal-hd">
          <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--blue-t)', color: 'var(--blue)', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <Icon name={typeIcon(doc.mimeType)} size={19} />
          </span>
          <div>
            <h2 id="dm-title">{doc.title}</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              {doc.owner} · {human(doc.sizeBytes)} · uploaded{' '}
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
                <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{doc.originalName}</p>
                <p className="sub" style={{ margin: '0 0 16px' }}>
                  Word and Excel files cannot be previewed in the browser.
                </p>
                <a className="btn btn-o btn-sm" href={`/api/documents/${doc.id}`} download>
                  <Icon name="download" size={14} />Download to view
                </a>
              </div>
            )}
          </div>

          {canReview && (
            <div className="grid2" style={{ gap: 14, marginBottom: 16 }}>
              <div>
                <label className="sub" htmlFor="dm-title-in" style={{ display: 'block', marginBottom: 6 }}>Title</label>
                <input id="dm-title-in" className="inp" style={{ width: '100%' }} value={title}
                  onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <label className="sub" htmlFor="dm-kind" style={{ display: 'block', marginBottom: 6 }}>Kind</label>
                <select id="dm-kind" className="inp" style={{ width: '100%' }} value={kind}
                  onChange={(e) => setKind(e.target.value)}>
                  {kinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </div>
            </div>
          )}

          {canReview && (
            <div>
              <label className="sub" htmlFor="dm-note" style={{ display: 'block', marginBottom: 6 }}>
                Note {confirmDelete ? '(required to delete)' : '(optional)'}
              </label>
              <textarea id="dm-note" className="inp" rows={2} style={{ width: '100%' }}
                value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={confirmDelete ? 'Why is this being deleted?' : 'Anything the next person should know'} />
            </div>
          )}

          {error && (
            <p className="pill p-bad" style={{ marginTop: 14, padding: '10px 13px' }} role="alert">
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>

        <div className="modal-ft">
          <a className="btn btn-o btn-sm" style={{ marginRight: 'auto' }}
            href={`/api/documents/${doc.id}`} download>
            <Icon name="download" size={14} />Download
          </a>

          {canDelete && !confirmDelete && (
            <button className="btn btn-o" onClick={() => setConfirmDelete(true)}>Delete</button>
          )}
          {confirmDelete && (
            <button className="btn btn-d" disabled={pending || !note.trim()}
              onClick={() => run(() => actionDelete(doc.id, note), 'Document deleted')}>
              <Icon name="ban" size={15} />Confirm delete
            </button>
          )}

          {canReview && !confirmDelete && (
            <>
              {dirty && (
                <button className="btn btn-o" disabled={pending}
                  onClick={() => run(() => actionUpdate(doc.id, { title, kind }), 'Document updated')}>
                  Save changes
                </button>
              )}
              <button className="btn btn-o" disabled={pending}
                onClick={() => run(() => actionReview(doc.id, 'REJECTED', note), 'Document rejected')}>
                <Icon name="close" size={15} />Reject
              </button>
              <button className="btn btn-p" disabled={pending}
                onClick={() => run(() => actionReview(doc.id, 'ACCEPTED', note), 'Document accepted')}>
                <Icon name="check" size={15} />Accept
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
