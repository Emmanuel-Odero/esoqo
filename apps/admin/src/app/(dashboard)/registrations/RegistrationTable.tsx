'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { maskMsisdn } from '@esoko/domain';
import {
  actionGetDetail, actionEdit, actionVoid, actionRestore,
  actionRecordPayment, actionAmendPayment,
} from './actions';
import WalkInFlow from './WalkInFlow';

interface Row {
  id: string; officialName: string | null; knownAs: string | null; orgName: string | null;
  msisdn: string | null; county: string | null; workRaw: string | null;
  status: string; joiningAs: string; startedAt: string;
  voidedAt: string | null; voidReason: string | null;
}

const STATUS: Record<string, [string, string]> = {
  STARTED: ['p-mute', 'Started'],
  AWAITING_OTP: ['p-warn', 'Awaiting code'],
  VERIFIED: ['p-info', 'Verified'],
  COMPLETE: ['p-ok', 'Joined'],
  ABANDONED: ['p-bad', 'Abandoned'],
};

const JOINING = { me: 'Individual', group: 'Group', biz: 'Business' } as const;

export function RegistrationTable({
  rows, total, page, pages, counties, canEdit, canVoid, canCreate, canSeePii, canRecordPayment,
  type, q, county, status,
}: {
  rows: Row[]; total: number; page: number; pages: number; counties: string[];
  canEdit: boolean; canVoid: boolean; canCreate: boolean; canSeePii: boolean;
  canRecordPayment: boolean;
  type?: 'individuals' | 'organisations'; q: string; county: string; status: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const tabHref = (t?: 'individuals' | 'organisations') => {
    const p = new URLSearchParams();
    if (t) p.set('type', t);
    if (q) p.set('q', q);
    if (county) p.set('county', county);
    if (status) p.set('status', status);
    return `/registrations${p.toString() ? `?${p}` : ''}`;
  };

  return (
    <>
      <div className="ctl" role="tablist" aria-label="Registration type" style={{ marginBottom: 10 }}>
        {([[undefined, 'All'], ['individuals', 'Individuals'], ['organisations', 'Organisations']] as const)
          .map(([t, label]) => (
          <Link key={label} href={tabHref(t) as Route} role="tab" aria-selected={type === t}
            className={`btn ${type === t ? 'btn-p' : 'btn-o'} btn-sm`}>
            {label}
          </Link>
        ))}
      </div>

      <div className="ctl">
        <form className="srch" style={{ display: 'contents' }}>
          {type && <input type="hidden" name="type" value={type} />}
          <div className="srch">
            <span className="mg"><Icon name="search" size={16} /></span>
            <input className="inp" name="q" defaultValue={q} aria-label="Search registrations"
              placeholder="Name, group, work or phone…" />
          </div>
          <select className="inp" name="county" aria-label="Filter by county" defaultValue={county}>
            <option value="">All counties</option>
            {counties.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="inp" name="status" aria-label="Filter by status" defaultValue={status}>
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button className="btn btn-o" type="submit"><Icon name="filter" size={15} />Filter</button>
        </form>
        <Link className="btn btn-o" href="/registrations/duplicates">
          <Icon name="alert-triangle" size={15} />Duplicates
        </Link>
        {canCreate && (
          <button className="btn btn-p" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} />Add walk-in
          </button>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="users" size={22} /></span>
            <h3>No registrations match</h3>
            <p style={{ margin: 0 }}>Once someone joins they appear here immediately.</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th><th>Joining as</th><th>Phone</th><th>County</th>
                <th>Work</th><th>Status</th><th>Started</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [cls, label] = STATUS[r.status] ?? ['p-mute', r.status];
                return (
                  <tr key={r.id} style={r.voidedAt ? { opacity: 0.55 } : undefined}>
                    <td>
                      {r.orgName ? (
                        <>
                          <strong>{r.orgName}</strong>
                          <span className="sub" style={{ display: 'block' }}>
                            Founded by {r.knownAs || r.officialName || '—'}
                          </span>
                        </>
                      ) : (
                        <strong>{r.knownAs || r.officialName || '—'}</strong>
                      )}
                    </td>
                    <td className="sub">{JOINING[r.joiningAs as keyof typeof JOINING] ?? r.joiningAs}</td>
                    <td className="mono">
                      {r.msisdn ? (canSeePii ? r.msisdn : maskMsisdn(r.msisdn)) : '—'}
                    </td>
                    <td>{r.county ?? '—'}</td>
                    <td className="sub">{r.workRaw ?? '—'}</td>
                    <td>
                      <span className={`pill ${cls}`}>{label}</span>
                      {r.voidedAt && <span className="pill p-bad" style={{ marginLeft: 5 }}>Void</span>}
                    </td>
                    <td className="mono sub" style={{ fontSize: '.79rem' }}>
                      {r.startedAt.slice(0, 10)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-o btn-sm" onClick={() => setOpenId(r.id)}>
                        <Icon name="eye" size={14} />Open
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <nav className="ctl" style={{ marginTop: 16, justifyContent: 'center' }} aria-label="Pagination">
          <Link className="btn btn-o btn-sm" href={`?page=${Math.max(1, page - 1)}`}
            aria-disabled={page === 1}><Icon name="arrow-left" size={14} />Previous</Link>
          <span className="mono sub">{page} of {pages} · {total} records</span>
          <Link className="btn btn-o btn-sm" href={`?page=${Math.min(pages, page + 1)}`}
            aria-disabled={page === pages}>Next<Icon name="arrow-right" size={14} /></Link>
        </nav>
      )}

      {openId && (
        <DetailDrawer id={openId} canEdit={canEdit} canVoid={canVoid} canSeePii={canSeePii}
          canRecordPayment={canRecordPayment} onClose={() => setOpenId(null)} />
      )}
      {creating && <WalkInFlow counties={counties} onClose={() => setCreating(false)} />}
    </>
  );
}

/* ─────────────────────────── detail drawer ─────────────────────────── */

type Detail = Awaited<ReturnType<typeof actionGetDetail>>;

function DetailDrawer({
  id, canEdit, canVoid, canSeePii, canRecordPayment, onClose,
}: {
  id: string; canEdit: boolean; canVoid: boolean; canSeePii: boolean;
  canRecordPayment: boolean; onClose: () => void;
}) {
  const [d, setD] = useState<Detail>(null);
  const [tab, setTab] = useState<'record' | 'payment' | 'documents'>('record');
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  const [payingForm, setPayingForm] = useState(false);
  const [payMethod, setPayMethod] = useState<'MPESA' | 'BANK_TRANSFER' | 'CASH_TO_AGENT'>('MPESA');
  const [payRef, setPayRef] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');

  const load = useCallback(async () => {
    const res = await actionGetDetail(id);
    setD(res);
    if (res) {
      setForm({
        officialName: res.officialName ?? '', knownAs: res.knownAs ?? '',
        county: res.county ?? '', ward: res.ward ?? '', workRaw: res.workRaw ?? '',
        orgName: res.orgName ?? '',
      });
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  function save() {
    start(async () => {
      const r = await actionEdit(id, form);
      if (r.ok) { announce('Registration updated', 'assertive'); setEditing(false); void load(); }
      else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  function doVoid() {
    if (!reason.trim()) { setError('A reason is required'); return; }
    start(async () => {
      const r = await actionVoid(id, reason);
      if (r.ok) { announce('Registration voided', 'assertive'); onClose(); }
      else setError(r.error);
    });
  }

  function doRestore() {
    start(async () => {
      const r = await actionRestore(id);
      if (r.ok) { announce('Registration restored', 'assertive'); void load(); }
      else setError(r.error);
    });
  }

  function openPaymentForm(existing?: NonNullable<Detail>['payment']) {
    setPayMethod((existing?.method as typeof payMethod) ?? 'MPESA');
    setPayRef(existing?.reference ?? '');
    setPayAmount(existing?.amountKes != null ? String(existing.amountKes) : '');
    setPayNote('');
    setError(null);
    setPayingForm(true);
  }

  function savePayment(existingPaymentId?: string) {
    if (!payRef.trim()) { setError('Enter a reference'); return; }
    start(async () => {
      const input = {
        method: payMethod, reference: payRef,
        amountKes: payAmount ? Number(payAmount) : undefined,
        note: payNote || undefined,
      };
      const r = existingPaymentId
        ? await actionAmendPayment(existingPaymentId, { ...input, amountKes: Number(payAmount) || 0 })
        : await actionRecordPayment(id, input);
      if (r.ok) {
        announce(existingPaymentId ? 'Payment amended' : 'Payment recorded', 'assertive');
        setPayingForm(false);
        void load();
      } else setError(r.error);
    });
  }

  if (!d) {
    return (
      <div className="scrim" role="dialog" aria-modal="true" aria-label="Loading registration">
        <div className="modal narrow"><div className="modal-bd"><p className="sub">Loading…</p></div></div>
      </div>
    );
  }

  const name = d.knownAs || d.officialName || 'Unnamed';
  const pay = d.payment;

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="rd-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-hd">
          <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--green-t)', color: 'var(--green)', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <Icon name="user" size={19} />
          </span>
          <div>
            <h2 id="rd-title">{name}</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              {d.county ?? '—'} · started {d.startedAt.slice(0, 10)}
              {d.voidedAt && ' · VOIDED'}
            </p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: 2, padding: '0 24px', borderBottom: '1px solid var(--line)' }}
          role="tablist" aria-label="Sections">
          {([['record', 'Record'], ['payment', 'Payment'], ['documents', `Documents (${d.documents.length})`]] as const)
            .map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              style={{
                background: 'none', border: 0, borderBottom: `3px solid ${tab === k ? 'var(--green)' : 'transparent'}`,
                padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '.9rem',
                fontWeight: tab === k ? 600 : 400, color: tab === k ? 'var(--navy)' : 'var(--tx-2)',
              }}>
              {label}
            </button>
          ))}
        </div>

        <div className="modal-bd">
          {d.voidedAt && (
            <p className="pill p-bad" style={{ padding: '10px 13px', marginBottom: 16 }}>
              <Icon name="ban" size={14} />
              Voided {d.voidedAt.slice(0, 10)} — {d.voidReason}
            </p>
          )}

          {tab === 'record' && (
            editing ? (
              <div className="grid2" style={{ gap: 14 }}>
                {([
                  ['officialName', 'Official name'], ['knownAs', 'Known as'],
                  ['orgName', 'Group name'], ['county', 'County'],
                  ['ward', 'Ward or market'], ['workRaw', 'Work'],
                ] as const).map(([k, label]) => (
                  <div key={k}>
                    <label className="sub" htmlFor={`f-${k}`} style={{ display: 'block', marginBottom: 6 }}>{label}</label>
                    <input id={`f-${k}`} className="inp" style={{ width: '100%' }} value={form[k] ?? ''}
                      onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))} />
                  </div>
                ))}
              </div>
            ) : (
              <table className="tbl">
                <tbody>
                  {([
                    ['Official name', d.officialName], ['Known as', d.knownAs],
                    ['Group', d.orgName], ['Role in group', d.orgRole],
                    ['Phone', d.msisdn ? (canSeePii ? d.msisdn : maskMsisdn(d.msisdn)) : null],
                    ['Phone confirmed', d.msisdnVerifiedAt ? d.msisdnVerifiedAt.slice(0, 10) : 'Not yet'],
                    ['Email', d.email], ['County', d.county], ['Ward', d.ward],
                    ['Work', d.workRaw], ['Segment', d.segment],
                    ['Registered business', d.hasRegisteredBusiness],
                    ['In a group', d.belongsToGroup === 'yes' ? (d.groupName ?? 'Yes') : d.belongsToGroup],
                    ['Group linked', d.groupPartyId ? 'Yes — matched to an existing group' : null],
                    ['Fee coverage', d.feeCoverage === 'group' ? 'Group covers it' : d.feeCoverage === 'self' ? 'Paying themselves' : null],
                    ['Members', d.memberCount], ['KRA PIN', d.hasKraPin],
                    ['Dialling access', d.ussdSetupChoice],
                    ['Wants price SMS', d.wantsPriceSms ? 'Yes' : 'No'],
                    ['Wants receipts', d.wantsReceiptSms ? 'Yes' : 'No'],
                    ['Wants expiry warnings', d.wantsExpirySms ? 'Yes' : 'No'],
                    ['Joined via', d.path],
                  ] as const).filter(([, v]) => v !== null && v !== undefined && v !== '')
                    .map(([k, v]) => (
                      <tr key={k}><td className="sub" style={{ width: 190 }}>{k}</td><td>{String(v)}</td></tr>
                    ))}
                </tbody>
              </table>
            )
          )}

          {tab === 'payment' && (
            !pay ? (
              payingForm ? (
                <PaymentForm
                  method={payMethod} setMethod={setPayMethod}
                  reference={payRef} setReference={setPayRef}
                  amount={payAmount} setAmount={setPayAmount}
                  note={payNote} setNote={setPayNote}
                  onCancel={() => setPayingForm(false)}
                  onSave={() => savePayment()}
                  pending={pending}
                  saveLabel="Record payment"
                />
              ) : (
                <div className="empty">
                  <span className="ico"><Icon name="coins" size={22} /></span>
                  <h3>No payment declared</h3>
                  <p style={{ margin: 0 }}>This person has not said anything about paying yet.</p>
                  {canRecordPayment && (
                    <button className="btn btn-p" style={{ marginTop: 14 }} onClick={() => openPaymentForm()}>
                      <Icon name="coins" size={14} />Record a payment
                    </button>
                  )}
                </div>
              )
            ) : payingForm ? (
              <PaymentForm
                method={payMethod} setMethod={setPayMethod}
                reference={payRef} setReference={setPayRef}
                amount={payAmount} setAmount={setPayAmount}
                note={payNote} setNote={setPayNote}
                onCancel={() => setPayingForm(false)}
                onSave={() => savePayment(pay.id)}
                pending={pending}
                saveLabel="Save changes"
              />
            ) : (
              <>
                <table className="tbl" style={{ marginBottom: 18 }}>
                  <tbody>
                    <tr><td className="sub" style={{ width: 190 }}>Status</td>
                      <td><span className="pill p-info">{pay.status.replace(/_/g, ' ').toLowerCase()}</span></td></tr>
                    <tr><td className="sub">Method</td><td>{pay.method ?? '—'}</td></tr>
                    <tr><td className="sub">Reference</td><td className="mono">{pay.reference ?? '—'}</td></tr>
                    <tr><td className="sub">Amount</td>
                      <td className="mono">{pay.amountKes ? `KES ${pay.amountKes.toLocaleString('en-KE')}` : '—'}</td></tr>
                    <tr><td className="sub">Declared</td>
                      <td>{pay.declaredAt ? new Date(pay.declaredAt).toLocaleString('en-KE') : '—'}</td></tr>
                    {pay.declaredNote && (
                      <tr><td className="sub">Their note</td><td>{pay.declaredNote}</td></tr>
                    )}
                  </tbody>
                </table>

                {canRecordPayment && (pay.status === 'DECLARED' || pay.status === 'UNDER_REVIEW') && (
                  <button className="btn btn-o btn-sm" style={{ marginBottom: 18 }}
                    onClick={() => openPaymentForm(pay)}>
                    <Icon name="document" size={13} />Amend this payment
                  </button>
                )}

                <h3 style={{ marginBottom: 10 }}>Signatures</h3>
                {pay.approvals.length === 0 ? (
                  <p className="sub">Nobody has signed yet. Approve from the Payments page.</p>
                ) : pay.approvals.map((a) => (
                  <div className="sig" key={a.id}>
                    <span className={`av ${a.decision === 'APPROVE' ? 'a' : 'r'}`}>
                      {a.approver.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                    </span>
                    <div style={{ flex: 1 }}>
                      <strong style={{ fontSize: '.91rem' }}>{a.approver.name}</strong>
                      <span className="sub" style={{ display: 'block', fontSize: '.8rem' }}>
                        {new Date(a.signedAt).toLocaleString('en-KE')}
                        {a.note && ` — ${a.note}`}
                      </span>
                    </div>
                    <span className={`pill ${a.decision === 'APPROVE' ? 'p-ok' : 'p-bad'}`}>
                      {a.decision === 'APPROVE' ? 'Approved' : 'Rejected'}
                    </span>
                  </div>
                ))}
              </>
            )
          )}

          {tab === 'documents' && (
            d.documents.length === 0 ? (
              <div className="empty">
                <span className="ico"><Icon name="document" size={22} /></span>
                <h3>No documents</h3>
                <p style={{ margin: 0 }}>Nothing was uploaded with this registration.</p>
              </div>
            ) : (
              <div className="dgrid">
                {d.documents.map((doc) => (
                  <a className="dcard" key={doc.id} href={`/api/documents/${doc.id}?inline=1`}
                    target="_blank" rel="noreferrer">
                    <div className="thumb">
                      {doc.mimeType.startsWith('image/')
                        ? <img src={`/api/documents/${doc.id}?inline=1`} alt="" loading="lazy" />
                        : <Icon name="document" size={28} />}
                    </div>
                    <div className="meta">
                      <span className="t">{doc.title}</span>
                      <span className="sub" style={{ display: 'block', fontSize: '.78rem', margin: '2px 0 8px' }}>
                        {Math.round(doc.sizeBytes / 1024)} KB
                      </span>
                      <span className={`pill ${doc.status === 'ACCEPTED' ? 'p-ok' : doc.status === 'REJECTED' ? 'p-bad' : 'p-warn'}`}>
                        {doc.status.replace(/_/g, ' ').toLowerCase()}
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            )
          )}

          {voiding && (
            <div style={{ marginTop: 18 }}>
              <label className="sub" htmlFor="void-reason" style={{ display: 'block', marginBottom: 6 }}>
                Why is this being voided? (required, recorded in the audit log)
              </label>
              <textarea id="void-reason" className="inp" rows={2} style={{ width: '100%' }}
                value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Duplicate of an earlier registration…" />
            </div>
          )}

          {error && (
            <p className="pill p-bad" style={{ marginTop: 14, padding: '10px 13px' }} role="alert">
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>

        <div className="modal-ft">
          {canVoid && !d.voidedAt && !voiding && (
            <button className="btn btn-o" style={{ marginRight: 'auto' }} onClick={() => setVoiding(true)}>
              <Icon name="ban" size={15} />Void
            </button>
          )}
          {canVoid && d.voidedAt && (
            <button className="btn btn-o" style={{ marginRight: 'auto' }} onClick={doRestore} disabled={pending}>
              <Icon name="refresh" size={15} />Restore
            </button>
          )}
          {voiding ? (
            <>
              <button className="btn btn-o" onClick={() => { setVoiding(false); setError(null); }}>Cancel</button>
              <button className="btn btn-d" onClick={doVoid} disabled={pending || !reason.trim()}>
                Confirm void
              </button>
            </>
          ) : editing ? (
            <>
              <button className="btn btn-o" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn btn-p" onClick={save} disabled={pending}>
                <Icon name="check" size={15} />Save changes
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-o" onClick={onClose}>Close</button>
              {canEdit && !d.voidedAt && (
                <button className="btn btn-p" onClick={() => setEditing(true)}>
                  <Icon name="document" size={15} />Edit
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PaymentForm({
  method, setMethod, reference, setReference, amount, setAmount, note, setNote,
  onCancel, onSave, pending, saveLabel,
}: {
  method: 'MPESA' | 'BANK_TRANSFER' | 'CASH_TO_AGENT';
  setMethod: (m: 'MPESA' | 'BANK_TRANSFER' | 'CASH_TO_AGENT') => void;
  reference: string; setReference: (v: string) => void;
  amount: string; setAmount: (v: string) => void;
  note: string; setNote: (v: string) => void;
  onCancel: () => void; onSave: () => void; pending: boolean; saveLabel: string;
}) {
  return (
    <div className="grid2" style={{ gap: 14 }}>
      <div>
        <label className="sub" htmlFor="pf-method" style={{ display: 'block', marginBottom: 6 }}>Method</label>
        <select id="pf-method" className="inp" style={{ width: '100%' }} value={method}
          onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option value="MPESA">M-Pesa</option>
          <option value="BANK_TRANSFER">Bank transfer</option>
          <option value="CASH_TO_AGENT">Cash to agent</option>
        </select>
      </div>
      <div>
        <label className="sub" htmlFor="pf-ref" style={{ display: 'block', marginBottom: 6 }}>
          Reference {method === 'MPESA' && '(the M-Pesa code)'}
        </label>
        <input id="pf-ref" className="inp" style={{ width: '100%' }} value={reference}
          onChange={(e) => setReference(e.target.value)} placeholder="SFH4K2L9QW" />
      </div>
      <div>
        <label className="sub" htmlFor="pf-amount" style={{ display: 'block', marginBottom: 6 }}>Amount (KES)</label>
        <input id="pf-amount" className="inp" type="number" style={{ width: '100%' }} value={amount}
          onChange={(e) => setAmount(e.target.value)} placeholder="500" />
      </div>
      <div>
        <label className="sub" htmlFor="pf-note" style={{ display: 'block', marginBottom: 6 }}>Note (optional)</label>
        <input id="pf-note" className="inp" style={{ width: '100%' }} value={note}
          onChange={(e) => setNote(e.target.value)} placeholder="Paid to Agent #14 at the market" />
      </div>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn btn-o" onClick={onCancel}>Cancel</button>
        <button className="btn btn-p" onClick={onSave} disabled={pending || !reference.trim()}>
          <Icon name="check" size={15} />{pending ? 'Saving…' : saveLabel}
        </button>
      </div>
    </div>
  );
}


