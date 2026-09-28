'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { maskMsisdn } from '@esoqo/domain';
import {
  actionGetDetail, actionEdit, actionVoid, actionRestore,
  actionRecordPayment, actionAmendPayment, actionAssignUserPin,
  actionSearchGroupsForStaff, actionAssignToGroup, actionAssignGroupIntent,
  actionUploadWalkInDocument, actionRemoveWalkInDocument,
} from './actions';
import WalkInFlow from './WalkInFlow';
import NationalIdPanel from './NationalIdPanel';

interface Row {
  id: string; officialName: string | null; knownAs: string | null; orgName: string | null;
  bizName: string | null;
  msisdn: string | null; county: string | null; workRaw: string | null;
  status: string; joiningAs: string; path: string; startedAt: string;
  groupPartyId: string | null; groupOrgName: string | null;
  bizPartyId: string | null; bizOrgName: string | null;
  belongsToGroup: string | null; groupName: string | null;
  voidedAt: string | null; voidReason: string | null;
  lastStep: number; feeCoverage: string | null;
}

/**
 * WordPress's CECF wizard (services/cecf-wordpress/.../registration.js)
 * collects everything client-side and only creates a Registration row
 * once the "you" step is reached, unlike apps/app/join's own per-step
 * Server Actions — so `status: STARTED` alone doesn't say where in the
 * six-to-eight-step wizard someone actually stalled. registration.js
 * pings `/api/cecf/registration/:id/progress` after every step
 * transition to bump `lastStep`; this mirrors its own `SEQUENCES` so
 * that number becomes a real "stuck on payment" / "stuck on documents"
 * label here instead of a bare integer. Keep in sync with that file if
 * its step order ever changes.
 */
const CECF_SEQUENCES: Record<string, { name: string; label: string }[]> = {
  me: [
    { name: 'who', label: "who's joining" }, { name: 'you', label: 'your details' },
    { name: 'payment', label: 'registration fee' }, { name: 'review', label: 'review & confirm' },
  ],
  biz: [
    { name: 'who', label: "who's joining" }, { name: 'biz-info', label: 'business details' },
    { name: 'you', label: 'your details' }, { name: 'documents', label: 'documents' },
    { name: 'payment', label: 'registration fee' }, { name: 'review', label: 'review & confirm' },
  ],
  group: [
    { name: 'who', label: "who's joining" }, { name: 'group-info', label: 'group details' },
    { name: 'you', label: 'your details' }, { name: 'documents', label: 'documents' },
    { name: 'fee-coverage', label: 'fee coverage' }, { name: 'payment', label: 'registration fee' },
    { name: 'roster', label: 'member roster' }, { name: 'review', label: 'review & confirm' },
  ],
};

function cecfStepLabel(r: Row): string | null {
  if (r.path !== 'CECF_WEB' || (r.status !== 'STARTED' && r.status !== 'AWAITING_OTP')) return null;
  const who = r.joiningAs === 'group' ? 'group' : r.joiningAs === 'biz' ? 'biz' : 'me';
  const seq = (CECF_SEQUENCES[who] ?? [])
    .filter((s) => !(who === 'group' && r.feeCoverage === 'self' && s.name === 'payment'));
  if (!seq.length) return null;
  const step = Math.min(Math.max(r.lastStep, 1), seq.length);
  return `Step ${step} of ${seq.length} · ${seq[step - 1]?.label}`;
}

const STATUS: Record<string, [string, string]> = {
  STARTED: ['p-mute', 'Started'],
  AWAITING_OTP: ['p-warn', 'Awaiting code'],
  VERIFIED: ['p-info', 'Verified'],
  COMPLETE: ['p-ok', 'Joined'],
  ABANDONED: ['p-bad', 'Abandoned'],
};

/**
 * "Joining as: Group" used to mean two very different things with no
 * way to tell them apart — someone typing in a brand-new group's name
 * (they're founding it) and someone picking an already-registered
 * group off the search list (they're just joining it as a member).
 * Same split applies to businesses, and an "Individual" registrant can
 * separately say they belong to a group too (belongsToGroup) — that's
 * a third, previously-invisible shape. This resolves all of it into
 * one label + colour + (when there's a group/business involved) a
 * name to show, computed the same way completeRegistration itself
 * decides "new org" vs "joined existing" — orgName/bizName present
 * means they typed a new one; its absence with a party id present
 * means they picked an existing one from search.
 */
type RegKind = 'individual' | 'individual-member' | 'group-new' | 'group-member' | 'biz-new' | 'biz-contact';

function regKind(r: Row): RegKind {
  if (r.joiningAs === 'group') return r.orgName ? 'group-new' : 'group-member';
  if (r.joiningAs === 'biz') return r.bizName ? 'biz-new' : 'biz-contact';
  return r.belongsToGroup === 'yes' ? 'individual-member' : 'individual';
}

const REG_KIND_META: Record<RegKind, { label: string; pill: string }> = {
  'individual': { label: 'Individual', pill: 'p-mute' },
  'individual-member': { label: 'Individual · group member', pill: 'p-info' },
  'group-new': { label: 'New group', pill: 'p-ok' },
  'group-member': { label: 'Group member', pill: 'p-info' },
  'biz-new': { label: 'New business', pill: 'p-ok' },
  'biz-contact': { label: 'Business contact', pill: 'p-info' },
};

export function RegistrationTable({
  rows, total, page, pages, counties, canEdit, canVoid, canCreate, canSeePii, canRecordPayment,
  canAssignUser, canManageMembership, canUploadDocs, documentKinds, type, source, q, county, status,
}: {
  rows: Row[]; total: number; page: number; pages: number; counties: string[];
  canEdit: boolean; canVoid: boolean; canCreate: boolean; canSeePii: boolean;
  canRecordPayment: boolean; canAssignUser: boolean; canManageMembership: boolean;
  canUploadDocs: boolean; documentKinds: [string, string][];
  type?: 'individuals' | 'organisations'; source?: 'CECF' | 'ESOKO'; q: string; county: string; status: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const tabHref = (t?: 'individuals' | 'organisations') => {
    const p = new URLSearchParams();
    if (t) p.set('type', t);
    if (source) p.set('source', source);
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
          <select className="inp" name="source" aria-label="Filter by source" defaultValue={source ?? ''}>
            <option value="">Any source</option>
            <option value="CECF">CECF registrations</option>
            <option value="ESOKO">Esoqo app registrations</option>
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
                <th>Name</th><th>Registration type</th><th>Phone</th><th>County</th>
                <th>Work</th><th>Status</th><th>Started</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [cls, label] = STATUS[r.status] ?? ['p-mute', r.status];
                const kind = regKind(r);
                const meta = REG_KIND_META[kind];
                const personName = r.officialName || r.knownAs || '—';
                return (
                  <tr key={r.id} style={r.voidedAt ? { opacity: 0.55 } : undefined}>
                    <td>
                      {kind === 'group-new' ? (
                        <>
                          <strong>{r.orgName}</strong>
                          <span className="sub" style={{ display: 'block' }}>Founded by {personName}</span>
                        </>
                      ) : kind === 'biz-new' ? (
                        <>
                          <strong>{r.bizName}</strong>
                          <span className="sub" style={{ display: 'block' }}>Founded by {personName}</span>
                        </>
                      ) : kind === 'group-member' || kind === 'individual-member' ? (
                        <>
                          <strong>{personName}</strong>
                          <span className="sub" style={{ display: 'block' }}>
                            Member of{' '}
                            {r.groupPartyId ? (
                              <Link href={`/groups/${r.groupPartyId}` as Route} style={{ color: 'var(--blue-2)' }}>
                                {r.groupOrgName || r.groupName || 'a group'}
                              </Link>
                            ) : (r.groupOrgName || r.groupName || 'a group')}
                          </span>
                        </>
                      ) : kind === 'biz-contact' ? (
                        <>
                          <strong>{personName}</strong>
                          <span className="sub" style={{ display: 'block' }}>
                            Contact for {r.bizOrgName || 'a business'}
                          </span>
                        </>
                      ) : (
                        <>
                          <strong>{personName}</strong>
                          {r.officialName && r.knownAs && (
                            <span className="sub" style={{ display: 'block' }}>Known as {r.knownAs}</span>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <span className={`pill ${meta.pill}`}>{meta.label}</span>
                      {r.path === 'CECF_WEB' && (
                        <span className="pill p-mute" style={{ marginLeft: 6 }} title="Registered via the CECF WordPress site">
                          CECF
                        </span>
                      )}
                    </td>
                    <td className="mono">
                      {r.msisdn ? (canSeePii ? r.msisdn : maskMsisdn(r.msisdn)) : '—'}
                    </td>
                    <td>{r.county ?? '—'}</td>
                    <td className="sub">{r.workRaw ?? '—'}</td>
                    <td>
                      <span className={`pill ${cls}`}>{label}</span>
                      {r.voidedAt && <span className="pill p-bad" style={{ marginLeft: 5 }}>Void</span>}
                      {cecfStepLabel(r) && (
                        <span className="sub" style={{ display: 'block', marginTop: 4, fontSize: '.79rem' }}>
                          {cecfStepLabel(r)}
                        </span>
                      )}
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
          canRecordPayment={canRecordPayment} canAssignUser={canAssignUser}
          canManageMembership={canManageMembership} canUploadDocs={canUploadDocs}
          documentKinds={documentKinds} onClose={() => setOpenId(null)} />
      )}
      {creating && <WalkInFlow counties={counties} onClose={() => setCreating(false)} />}
    </>
  );
}

/* ─────────────────────────── detail drawer ─────────────────────────── */

type Detail = Awaited<ReturnType<typeof actionGetDetail>>;

function DetailDrawer({
  id, canEdit, canVoid, canSeePii, canRecordPayment, canAssignUser,
  canManageMembership, canUploadDocs, documentKinds, onClose,
}: {
  id: string; canEdit: boolean; canVoid: boolean; canSeePii: boolean;
  canRecordPayment: boolean; canAssignUser: boolean; canManageMembership: boolean;
  canUploadDocs: boolean; documentKinds: [string, string][]; onClose: () => void;
}) {
  const [d, setD] = useState<Detail>(null);
  const [tab, setTab] = useState<'record' | 'payment' | 'documents' | 'account' | 'nationalId'>('record');
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [tempPin, setTempPin] = useState<string | null>(null);
  const [assigningGroup, setAssigningGroup] = useState(false);
  const [uploading, setUploading] = useState(false);
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
        msisdn: res.msisdn ?? '', email: res.email ?? '',
        county: res.county ?? '', ward: res.ward ?? '', workRaw: res.workRaw ?? '',
        orgName: res.orgName ?? '', orgKnownAs: res.orgKnownAs ?? '',
        registrationNo: res.registrationNo ?? '',
        memberCount: res.memberCount != null ? String(res.memberCount) : '',
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
      const { memberCount, ...rest } = form;
      const payload: Record<string, unknown> = { ...rest };
      if (memberCount !== undefined) payload.memberCount = memberCount.trim() ? Number(memberCount) : null;
      const r = await actionEdit(id, payload);
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

  function assignPin(personId: string) {
    setError(null);
    start(async () => {
      const r = await actionAssignUserPin(personId);
      if (r.ok) { setTempPin(r.data.tempPin); announce('Login PIN assigned', 'assertive'); }
      else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  function assignGroup(group: { id: string; name: string }) {
    setError(null);
    start(async () => {
      // Once a registration has become a real person, group membership
      // lives on Membership, not the Registration row — completeRegistration
      // refuses to touch a COMPLETE registration's own fields anyway. Before
      // that, this is just intent recorded on the registration itself
      // (see setRegistrationGroupIntent), honoured automatically once
      // it completes.
      const r = d?.party?.person
        ? await actionAssignToGroup(d.party.person.partyId, group.id)
        : await actionAssignGroupIntent(id, group.id, group.name);
      if (r.ok) {
        announce(`Assigned to ${group.name}`, 'assertive');
        setAssigningGroup(false);
        void load();
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  function removeDocument(docId: string) {
    start(async () => {
      const r = await actionRemoveWalkInDocument(docId);
      if (r.ok) { announce('Document removed', 'assertive'); void load(); }
      else { setError(r.error ?? 'Could not remove that file'); }
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

  const name = d.officialName || d.knownAs || 'Unnamed';
  const pay = d.payment;

  return (
    <div className="scrim" role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rd-title">
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
          {([['record', 'Record'], ['payment', 'Payment'], ['documents', `Documents (${d.documents.length})`],
             ['account', 'Account'],
             ...(canSeePii && d.party?.person ? [['nationalId', 'National ID'] as const] : [])] as const)
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
                  ...(canSeePii ? [['msisdn', 'Phone number'], ['email', 'Email']] as const : []),
                  ['county', 'County'], ['ward', 'Ward or market'],
                  ['workRaw', 'Work'],
                  ['orgName', 'Group name'], ['orgKnownAs', 'Group known as'],
                  ['registrationNo', 'Group registration number'], ['memberCount', 'Group member count'],
                ] as const).map(([k, label]) => (
                  <div key={k}>
                    <label className="sub" htmlFor={`f-${k}`} style={{ display: 'block', marginBottom: 6 }}>{label}</label>
                    <input id={`f-${k}`} className="inp" style={{ width: '100%' }} value={form[k] ?? ''}
                      type={k === 'memberCount' ? 'number' : 'text'} min={k === 'memberCount' ? 0 : undefined}
                      onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))} />
                  </div>
                ))}
                {!canSeePii && (
                  <p className="sub" style={{ gridColumn: '1 / -1', margin: 0 }}>
                    Phone and email are hidden without <code className="mono">party.pii</code> — ask someone who
                    holds it to correct those.
                  </p>
                )}
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
                    ['In a group', d.party
                      ? (d.party.memberships?.length
                        ? d.party.memberships.map((m) => m.org.knownAs || m.org.officialName).join(', ')
                        : 'No')
                      : (d.belongsToGroup === 'yes' ? (d.groupName ?? 'Yes') : d.belongsToGroup)],
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

          {tab === 'record' && !editing && (canManageMembership || canEdit) && (
            <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
              <h3 style={{ marginBottom: 10 }}>Group membership</h3>
              {d.party?.memberships && d.party.memberships.length > 0 ? (
                d.party.memberships.map((m) => (
                  <p key={m.orgId} className="pill p-info" style={{ padding: '10px 13px', marginBottom: 10 }}>
                    <Icon name="users" size={14} />
                    {m.org.knownAs || m.org.officialName} · {m.role === 'OTHER' ? (m.customRole || 'Other') : m.role}
                  </p>
                ))
              ) : (
                <p className="sub" style={{ marginBottom: 10 }}>Not currently a member of any group.</p>
              )}
              {canManageMembership && (
                <button className="btn btn-o btn-sm" onClick={() => setAssigningGroup(true)}>
                  <Icon name="users" size={13} />
                  {d.party?.memberships?.length ? 'Move to another group' : 'Assign to a group'}
                </button>
              )}
              {!d.party && (
                <p className="sub" style={{ marginTop: 8, fontSize: '.79rem' }}>
                  Not complete yet — assigning now sets which group this joins automatically once it is.
                </p>
              )}
            </div>
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
            <>
              {canUploadDocs && (
                <button className="btn btn-o btn-sm" style={{ marginBottom: 16 }} onClick={() => setUploading(true)}>
                  <Icon name="plus" size={13} />Upload document
                </button>
              )}
              {d.documents.length === 0 ? (
                <div className="empty">
                  <span className="ico"><Icon name="document" size={22} /></span>
                  <h3>No documents</h3>
                  <p style={{ margin: 0 }}>Nothing was uploaded with this registration.</p>
                </div>
              ) : (
                <div className="dgrid">
                  {d.documents.map((doc) => (
                    <a className="dcard" key={doc.id} href={`/api/documents/${doc.id}?inline=1`}
                      target="_blank" rel="noreferrer" style={{ position: 'relative' }}>
                      {canUploadDocs && (
                        <button type="button" className="x" aria-label={`Remove ${doc.title}`}
                          style={{ position: 'absolute', top: 6, right: 6, background: 'var(--paper)', borderRadius: 6 }}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeDocument(doc.id); }}>
                          <Icon name="close" size={13} />
                        </button>
                      )}
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
              )}
            </>
          )}

          {tab === 'account' && (
            !d.party?.person ? (
              <div className="empty">
                <span className="ico"><Icon name="user" size={22} /></span>
                <h3>No system account yet</h3>
                <p style={{ margin: 0 }}>
                  This registration has not completed, so there is no person record to assign a
                  login PIN to.
                </p>
              </div>
            ) : tempPin ? (
              <>
                <p className="pill p-ok" style={{ padding: '10px 13px', marginBottom: 16 }}>
                  <Icon name="check-circle" size={14} />PIN assigned
                </p>
                <p>
                  Give <strong>{name}</strong> this PIN. It is shown once and never stored in
                  readable form.
                </p>
                <p className="mono" style={{ fontSize: '2rem', letterSpacing: '.4em', textAlign: 'center', padding: '18px 0', background: 'var(--paper)', borderRadius: 10, margin: '14px 0' }}>
                  {tempPin}
                </p>
                <p className="sub">Do not send this by SMS or email. Hand it over in person or by phone.</p>
              </>
            ) : (
              <>
                <table className="tbl" style={{ marginBottom: 18 }}>
                  <tbody>
                    <tr><td className="sub" style={{ width: 190 }}>Login PIN</td>
                      <td>
                        <span className={`pill ${d.party.person.credential?.hasPinSet ? 'p-ok' : 'p-mute'}`}>
                          {d.party.person.credential?.hasPinSet ? 'Assigned' : 'Not assigned'}
                        </span>
                      </td></tr>
                    {d.party.person.credential?.pinSetAt && (
                      <tr><td className="sub">Set</td>
                        <td>{new Date(d.party.person.credential.pinSetAt).toLocaleString('en-KE')}</td></tr>
                    )}
                  </tbody>
                </table>
                {canAssignUser && (
                  <button className="btn btn-p btn-sm" disabled={pending}
                    onClick={() => assignPin(d.party!.person!.partyId)}>
                    <Icon name="key" size={13} />
                    {d.party.person.credential?.hasPinSet ? 'Reset login PIN' : 'Assign login PIN'}
                  </button>
                )}
              </>
            )
          )}

          {tab === 'nationalId' && d.party?.person && (
            <NationalIdPanel partyId={d.party.person.partyId} />
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

      {assigningGroup && (
        <AssignGroup name={name} onClose={() => setAssigningGroup(false)} onPick={assignGroup} />
      )}
      {uploading && (
        <UploadRegistrationDocument
          registrationId={id} documentKinds={documentKinds}
          onClose={() => setUploading(false)}
          onUploaded={() => { setUploading(false); void load(); }}
        />
      )}
    </div>
  );
}

function AssignGroup({
  name, onClose, onPick,
}: { name: string; onClose: () => void; onPick: (g: { id: string; name: string }) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; name: string; county: string }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function onInput(v: string) {
    setQ(v);
    clearTimeout(timer.current);
    if (v.trim().length < 2) { setHits([]); return; }
    timer.current = setTimeout(async () => {
      setHits(await actionSearchGroupsForStaff(v));
    }, 200);
  }

  return (
    <div className="scrim" role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="ag-title">
        <div className="modal-hd">
          <h2 id="ag-title">Assign {name} to a group</h2>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-bd">
          <label className="sub" htmlFor="ag-q" style={{ display: 'block', marginBottom: 6 }}>Group name</label>
          <input id="ag-q" className="inp" style={{ width: '100%' }} value={q} autoComplete="off"
            onChange={(e) => onInput(e.target.value)} placeholder="Search groups…" />
          <div style={{ marginTop: 10 }}>
            {hits.map((g) => (
              <button key={g.id} type="button" className="btn btn-o btn-sm" style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 6 }}
                onClick={() => onPick(g)}>
                {g.name} <span className="sub">— {g.county}</span>
              </button>
            ))}
            {q.trim().length >= 2 && hits.length === 0 && (
              <p className="sub">No matching groups.</p>
            )}
          </div>
        </div>
        <div className="modal-ft">
          <button className="btn btn-o" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function UploadRegistrationDocument({
  registrationId, documentKinds, onClose, onUploaded,
}: {
  registrationId: string;
  documentKinds: [string, string][];
  onClose: () => void;
  onUploaded: () => void;
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
      form.set('registrationId', registrationId);
      form.set('title', title);
      form.set('kind', kind);
      form.set('file', file);
      const r = await actionUploadWalkInDocument(form);
      if (r.ok) { announce(`${r.doc.title} uploaded`, 'assertive'); onUploaded(); }
      else setError(r.error);
    });
  }

  return (
    <div className="scrim" role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="urd-title">
        <div className="modal-hd">
          <h2 id="urd-title">Upload document</h2>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-bd">
          <label className="sub" htmlFor="urd-title-input" style={{ display: 'block', marginBottom: 6 }}>Title</label>
          <input id="urd-title-input" className="inp" style={{ width: '100%', marginBottom: 12 }}
            value={title} onChange={(e) => setTitle(e.target.value)} placeholder="National ID, front" />

          <label className="sub" htmlFor="urd-kind" style={{ display: 'block', marginBottom: 6 }}>Kind</label>
          <select id="urd-kind" className="inp" style={{ width: '100%', marginBottom: 12 }}
            value={kind} onChange={(e) => setKind(e.target.value)}>
            {documentKinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>

          <label className="sub" htmlFor="urd-file" style={{ display: 'block', marginBottom: 6 }}>
            File (PDF, Word, Excel or image — up to 10 MB)
          </label>
          <input id="urd-file" className="inp" type="file" style={{ width: '100%' }}
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


