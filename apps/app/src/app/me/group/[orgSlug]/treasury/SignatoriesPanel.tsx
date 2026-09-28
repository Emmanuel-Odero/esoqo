'use client';
import { useState, useTransition } from 'react';
import { Icon, Modal } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionAddSignatory, actionSetGroupSignerPermissions, actionRemoveGroupSigner } from './actions';

export interface SignerRow {
  personId: string;
  name: string;
  approveWithdrawals: boolean;
  addMembers: boolean;
  removeMembers: boolean;
  manageSignatories: boolean;
  editTreasurySettings: boolean;
  notifyOnContributions: boolean;
  notifyOnWithdrawals: boolean;
}

export interface MemberOption { personId: string; name: string }

// Mirrors FREE_SIGNER_LIMIT/SIGNATORY_FEE_KES in packages/db/src/dal/treasury.ts.
const FREE_SIGNER_LIMIT = 5;
const SIGNATORY_FEE_KES = 50;

const PERMISSION_FIELDS = [
  ['approveWithdrawals', 'Approve withdrawals', 'Counts toward the signatures a withdrawal needs.'],
  ['addMembers', 'Add members', 'Can invite new people into the group.'],
  ['removeMembers', 'Remove members', 'Can exit a member from the group.'],
  ['manageSignatories', 'Manage signatories', 'Can add/remove signatories and set their permissions.'],
  ['editTreasurySettings', 'Edit treasury settings', 'Contribution amount, cycle, join fee, standby time.'],
  ['notifyOnContributions', 'Notify on contributions', 'Texted the moment anyone contributes.'],
  ['notifyOnWithdrawals', 'Notify on withdrawals', 'Texted when a withdrawal is requested.'],
] as const;

const DEFAULT_PERMISSIONS = {
  approveWithdrawals: true, addMembers: false, removeMembers: false,
  manageSignatories: false, editTreasurySettings: false,
  notifyOnContributions: false, notifyOnWithdrawals: true,
};

export function SignatoriesPanel({ orgId, signers, nonSigners, canManage, officerFallback }: {
  orgId: string; signers: SignerRow[]; nonSigners: MemberOption[]; canManage: boolean;
  /** Names of officers currently covering signing by fallback — only
   *  non-empty when signers.length === 0 (see getEffectiveSignerIds in
   *  the DAL: no configured rows means the officer roles sign instead). */
  officerFallback: string[];
}) {
  const [showAdd, setShowAdd] = useState(false);
  const freeLeft = Math.max(0, FREE_SIGNER_LIMIT - signers.length);

  return (
    <section className="mcard">
      <h2><Icon name="shield" size={18} />Who can approve payments</h2>
      {signers.length === 0 ? (
        <p className="mcard-lede">
          Nobody&rsquo;s been added yet, so {officerFallback.join(', ') || 'your officers'} approve
          by default. Add people below to choose exactly who can approve, instead of leaving it to
          their officer role.
        </p>
      ) : (
        <p className="mcard-lede">
          {signers.length} {signers.length === 1 ? 'person' : 'people'} can approve a payment out. The first{' '}
          {FREE_SIGNER_LIMIT} are free — {freeLeft > 0
            ? `${freeLeft} more before a KES ${SIGNATORY_FEE_KES} fee applies.`
            : `adding another costs KES ${SIGNATORY_FEE_KES}, settled however you choose.`}
        </p>
      )}

      <ul className="papers">
        {signers.map((s) => (
          <SignerItem key={s.personId} orgId={orgId} signer={s} canManage={canManage} isLast={signers.length === 1} />
        ))}
      </ul>

      {canManage && (
        <>
          <button type="button" className="btn btn-o" style={{ marginTop: 12 }} onClick={() => setShowAdd(true)} disabled={nonSigners.length === 0}>
            <Icon name="plus" size={15} />Add someone
          </button>
          {showAdd && (
            <AddSignatoryForm orgId={orgId} nonSigners={nonSigners} atLimit={freeLeft === 0} onDone={() => setShowAdd(false)} />
          )}
        </>
      )}
    </section>
  );
}

type PermState = Pick<SignerRow, typeof PERMISSION_FIELDS[number][0]>;

function toPermState(s: SignerRow): PermState {
  const out = {} as PermState;
  for (const [key] of PERMISSION_FIELDS) out[key] = s[key];
  return out;
}

function SignerItem({ orgId, signer, canManage, isLast }: { orgId: string; signer: SignerRow; canManage: boolean; isLast: boolean }) {
  const [editing, setEditing] = useState(false);
  const [perms, setPerms] = useState<PermState>(() => toPermState(signer));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const announce = useAnnounce();

  const active = PERMISSION_FIELDS.filter(([key]) => signer[key]);

  function save() {
    setMsg(null);
    start(async () => {
      const r = await actionSetGroupSignerPermissions(orgId, signer.personId, perms);
      if (r.ok) { setEditing(false); announce('Permissions updated.', 'polite'); }
      else { setMsg(r.error); announce(r.error, 'assertive'); }
    });
  }

  function remove() {
    setMsg(null);
    start(async () => {
      const r = await actionRemoveGroupSigner(orgId, signer.personId);
      if (!r.ok) { setMsg(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <li className="paper" style={{ flexWrap: 'wrap' }}>
      <span className="ps ok" aria-hidden="true"><Icon name="shield-check" size={16} /></span>
      <span className="pt">
        <span className="t">{signer.name}</span>
        <span className="s">{active.map(([, label]) => label).join(' · ') || 'No permissions set'}</span>
        {msg && <span className="s" style={{ color: 'var(--red)' }}>{msg}</span>}
        {editing && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {PERMISSION_FIELDS.map(([key, label, hint]) => (
              <label key={key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '.86rem' }}>
                <input
                  type="checkbox" checked={perms[key]}
                  onChange={(e) => setPerms((p) => ({ ...p, [key]: e.target.checked }))}
                />
                <span><strong>{label}</strong> — <span style={{ color: 'var(--tx-2)' }}>{hint}</span></span>
              </label>
            ))}
            <div className="row" style={{ marginTop: 6 }}>
              <button type="button" className="btn btn-p btn-sm" disabled={pending} onClick={save}>Save</button>
              <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={() => { setPerms(toPermState(signer)); setEditing(false); }}>Cancel</button>
            </div>
          </div>
        )}
      </span>
      {canManage && !editing && (
        <div className="row">
          <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={() => setEditing(true)}>Edit</button>
          <button
            type="button" className="btn btn-o btn-sm" disabled={pending || isLast}
            title={isLast ? 'A group needs at least one signatory' : undefined}
            onClick={remove}
          >
            Remove
          </button>
        </div>
      )}
    </li>
  );
}

function AddSignatoryForm({ orgId, nonSigners, atLimit, onDone }: {
  orgId: string; nonSigners: MemberOption[]; atLimit: boolean; onDone: () => void;
}) {
  const [personId, setPersonId] = useState(nonSigners[0]?.personId ?? '');
  const [perms, setPerms] = useState(DEFAULT_PERMISSIONS);
  const [feeMethod, setFeeMethod] = useState<'STK_NEW_SIGNER' | 'STK_OFFICER' | 'GROUP_TREASURY'>('STK_NEW_SIGNER');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionAddSignatory(orgId, personId, perms, feeMethod);
      if (!r.ok) { setError(r.error); announce(r.error, 'assertive'); return; }
      if (r.data.status === 'FEE_PENDING') {
        setSent(r.data.msisdn);
        announce('STK prompt sent — enter the PIN to finish adding this signatory.', 'polite');
      } else {
        announce('Signatory added.', 'polite');
        onDone();
      }
    });
  }

  if (sent) {
    return (
      <Modal title="STK prompt sent" onClose={onDone} footer={<button type="button" className="btn btn-o" onClick={onDone}>Close</button>}>
        <p style={{ margin: 0 }}>
          <Icon name="check" size={14} /> Sent to {sent} — this person becomes a signatory
          once the KES {SIGNATORY_FEE_KES} fee is confirmed.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title="Add a signatory"
      onClose={onDone}
      footer={(
        <>
          <button type="button" className="btn btn-o" disabled={pending} onClick={onDone}>Cancel</button>
          <button type="button" className="btn btn-p" disabled={pending || !personId} onClick={submit}>
            {pending ? 'Adding…' : 'Add signatory'}
          </button>
        </>
      )}
    >
      <div className="fld"><label className="lab">Who</label>
        <select className="inp" value={personId} onChange={(e) => setPersonId(e.target.value)}>
          {nonSigners.map((m) => <option key={m.personId} value={m.personId}>{m.name}</option>)}
        </select>
      </div>
      <div className="fld"><label className="lab">Permissions</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PERMISSION_FIELDS.map(([key, label]) => (
            <label key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '.88rem' }}>
              <input type="checkbox" checked={perms[key]} onChange={(e) => setPerms((p) => ({ ...p, [key]: e.target.checked }))} />
              {label}
            </label>
          ))}
        </div>
      </div>
      {atLimit && (
        <div className="fld">
          <label className="lab">This is a paid seat — settle the KES {SIGNATORY_FEE_KES} fee by</label>
          <select className="inp" value={feeMethod} onChange={(e) => setFeeMethod(e.target.value as typeof feeMethod)}>
            <option value="STK_NEW_SIGNER">The new signatory pays (M-Pesa)</option>
            <option value="STK_OFFICER">I&rsquo;ll pay myself (M-Pesa)</option>
            <option value="GROUP_TREASURY">From the group&rsquo;s treasury balance</option>
          </select>
        </div>
      )}
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
    </Modal>
  );
}
