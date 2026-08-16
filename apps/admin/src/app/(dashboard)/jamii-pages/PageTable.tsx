'use client';

import { useEffect, useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import {
  actionModeratePage, actionVerifyPage, actionUnverifyPage,
  actionListTeam, actionInviteTeamMember, actionRemoveTeamMember,
} from './actions';

interface Row {
  id: string; slug: string; status: string; officialName: string; county: string;
  verified: boolean; teamCount: number; activeCampaigns: number; createdAt: string;
}

const STATUS: Record<string, [string, string]> = {
  DRAFT: ['p-warn', 'Draft'],
  PUBLISHED: ['p-ok', 'Published'],
  SUSPENDED: ['p-bad', 'Suspended'],
};

export function PageTable({
  rows, canModerate, canVerify, canManageTeam, q, status,
}: { rows: Row[]; canModerate: boolean; canVerify: boolean; canManageTeam: boolean; q: string; status: string }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="ctl">
        <form className="srch" style={{ display: 'contents' }}>
          <div className="srch">
            <span className="mg"><Icon name="search" size={16} /></span>
            <input className="inp" name="q" defaultValue={q} aria-label="Search pages"
              placeholder="Organisation name…" />
          </div>
          <select className="inp" name="status" aria-label="Filter by status" defaultValue={status}>
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button className="btn btn-o" type="submit"><Icon name="filter" size={15} />Filter</button>
        </form>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="handshake" size={22} /></span>
            <h3>No pages match</h3>
            <p style={{ margin: 0 }}>Pages appear here as soon as someone starts one on Our Jamii.</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Organisation</th><th>County</th><th>Status</th><th>Verified</th>
                <th>Team</th><th>Active campaigns</th><th>Started</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [cls, label] = STATUS[r.status] ?? ['p-mute', r.status];
                return (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.officialName}</strong>
                      <span className="sub" style={{ display: 'block' }}>/o/{r.slug}</span>
                    </td>
                    <td>{r.county}</td>
                    <td><span className={`pill ${cls}`}>{label}</span></td>
                    <td>
                      {r.verified
                        ? <span className="pill p-ok"><Icon name="shield-check" size={12} />Verified</span>
                        : <span className="sub">—</span>}
                    </td>
                    <td>{r.teamCount}</td>
                    <td>{r.activeCampaigns}</td>
                    <td className="sub">{new Date(r.createdAt).toLocaleDateString('en-KE')}</td>
                    <td>
                      <button className="btn btn-o btn-sm" onClick={() => setOpenId(r.id)}>
                        {canModerate || canVerify ? 'Manage' : 'View'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {openId && (
        <PageModal
          row={rows.find((r) => r.id === openId)!}
          canModerate={canModerate}
          canVerify={canVerify}
          canManageTeam={canManageTeam}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

const TEAM_ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', EDITOR: 'Editor', CONTRIBUTOR: 'Contributor' };

interface TeamMember { id: string; name: string; email: string; role: string; accepted: boolean }

function PageModal({
  row, canModerate, canVerify, canManageTeam, onClose,
}: { row: Row; canModerate: boolean; canVerify: boolean; canManageTeam: boolean; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState<'SUSPENDED' | 'unverify' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'EDITOR' | 'CONTRIBUTOR'>('ADMIN');

  useEffect(() => {
    if (!canManageTeam) return;
    let cancelled = false;
    actionListTeam(row.id).then((m) => { if (!cancelled) setTeam(m); });
    return () => { cancelled = true; };
  }, [canManageTeam, row.id]);

  function invite() {
    setError(null);
    start(async () => {
      const r = await actionInviteTeamMember(row.id, { name: inviteName, email: inviteEmail, role: inviteRole });
      if (r.ok) {
        setInviteName(''); setInviteEmail('');
        announce(`${inviteName} invited to manage this page`, 'polite');
        setTeam(await actionListTeam(row.id));
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  function removeMember(memberId: string) {
    start(async () => {
      const r = await actionRemoveTeamMember(row.id, memberId);
      if (r.ok) setTeam(await actionListTeam(row.id));
      else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

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
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pm-title">
        <div className="modal-hd">
          <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--blue-t)', color: 'var(--blue)', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <Icon name="handshake" size={19} />
          </span>
          <div>
            <h2 id="pm-title">{row.officialName}</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>/o/{row.slug} · {row.county}</p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

        <div className="modal-bd">
          <p style={{ margin: '0 0 16px' }}>
            <a href={`http://localhost:3004/o/${row.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-o btn-sm">
              <Icon name="arrow-right" size={14} />View public page
            </a>
          </p>

          {canManageTeam && (
            <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--line)' }}>
              <p className="sub" style={{ marginBottom: 8 }}>
                Team ({team?.length ?? row.teamCount}) — day-to-day editing stays with them; use this
                only to invite a chama&rsquo;s first admin while onboarding.
              </p>

              {team === null ? (
                <p className="sub">Loading…</p>
              ) : team.length === 0 ? (
                <p className="sub">No one invited yet.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
                  {team.map((m) => (
                    <li key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                      <span style={{ flex: 1 }}>
                        <strong>{m.name}</strong> <span className="sub">{m.email}</span>
                      </span>
                      <span className="pill p-info">{TEAM_ROLE_LABEL[m.role] ?? m.role}</span>
                      {!m.accepted && <span className="pill p-warn">Pending</span>}
                      <button className="btn btn-o btn-sm" disabled={pending} onClick={() => removeMember(m.id)}>
                        <Icon name="close" size={12} />Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input className="inp" style={{ flex: '1 1 140px' }} placeholder="Name" value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)} aria-label="Invite name" />
                <input className="inp" style={{ flex: '1 1 180px' }} type="email" placeholder="Email" value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)} aria-label="Invite email" />
                <select className="inp" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
                  aria-label="Invite role">
                  {Object.entries(TEAM_ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button className="btn btn-o btn-sm" disabled={pending || !inviteName.trim() || !inviteEmail.trim()}
                  onClick={invite}>
                  <Icon name="plus" size={14} />Invite
                </button>
              </div>
            </div>
          )}

          {(confirming === 'SUSPENDED' || confirming === 'unverify') && (
            <div style={{ marginBottom: 16 }}>
              <label className="sub" htmlFor="pm-reason" style={{ display: 'block', marginBottom: 6 }}>
                Reason (recorded in the audit log)
              </label>
              <textarea id="pm-reason" className="inp" rows={2} style={{ width: '100%' }}
                value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder={confirming === 'SUSPENDED' ? 'Why is this page being suspended?' : 'Why is verification being revoked?'} />
            </div>
          )}

          {error && (
            <p className="pill p-bad" style={{ marginTop: 4, padding: '10px 13px' }} role="alert">
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>

        <div className="modal-ft">
          {canVerify && !row.verified && (
            <button className="btn btn-o" disabled={pending}
              onClick={() => run(() => actionVerifyPage(row.id), 'Page verified')}>
              <Icon name="shield-check" size={15} />Verify
            </button>
          )}
          {canVerify && row.verified && confirming !== 'unverify' && (
            <button className="btn btn-o" disabled={pending} onClick={() => setConfirming('unverify')}>
              <Icon name="shield" size={15} />Revoke verification
            </button>
          )}
          {canVerify && confirming === 'unverify' && (
            <button className="btn btn-d" disabled={pending || !reason.trim()}
              onClick={() => run(() => actionUnverifyPage(row.id, reason), 'Verification revoked')}>
              Confirm revoke
            </button>
          )}

          {canModerate && row.status !== 'SUSPENDED' && confirming !== 'SUSPENDED' && (
            <button className="btn btn-o" disabled={pending} onClick={() => setConfirming('SUSPENDED')}>
              <Icon name="ban" size={15} />Suspend
            </button>
          )}
          {canModerate && confirming === 'SUSPENDED' && (
            <button className="btn btn-d" disabled={pending || !reason.trim()}
              onClick={() => run(() => actionModeratePage(row.id, 'SUSPENDED', reason), 'Page suspended')}>
              Confirm suspend
            </button>
          )}
          {canModerate && row.status === 'SUSPENDED' && (
            <button className="btn btn-p" disabled={pending}
              onClick={() => run(() => actionModeratePage(row.id, 'PUBLISHED', 'Reinstated by staff'), 'Page reinstated')}>
              <Icon name="check-circle" size={15} />Reinstate
            </button>
          )}
          {canModerate && row.status === 'DRAFT' && (
            <button className="btn btn-p" disabled={pending}
              onClick={() => run(() => actionModeratePage(row.id, 'PUBLISHED', 'Published by staff'), 'Page published')}>
              <Icon name="check" size={15} />Publish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
