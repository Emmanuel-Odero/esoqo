import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import { getMyRecord, GROUP_KINDS } from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { CreateGroupForm } from './CreateGroupForm';

// GROUP_KINDS includes BUSINESS (admin's Groups screen registers those
// too) — self-serve founding here is for chamas/table-banking/SACCOs
// etc. only, the same set createOwnGroupSchema accepts
// (JOINABLE_GROUP_KINDS). Resolved server-side so the client form never
// imports @esoqo/db (server-only) itself.
const GROUP_KIND_OPTIONS = GROUP_KINDS.filter(([k]) => k !== 'BUSINESS');

export const dynamic = 'force-dynamic';

/**
 * Directory only — each group's own detail lives at /me/group/[orgId]
 * (and its treasury at /me/group/[orgId]/treasury), so this page never
 * has to load one group's balance, members and withdrawals just to let
 * someone pick which group they meant. A person can belong to more than
 * one (see createOwnGroup in dal/groups.ts), which is the whole reason
 * this needs to be a list rather than always jumping straight to one.
 */
export default async function MyGroups() {
  const ctx = await requireSubject();
  const me = await getMyRecord(ctx);
  const memberships = me?.memberships ?? [];

  return (
    <>
      <header className="hero" style={{ padding: '4px 0 14px' }}>
        <p className="kicker">Your chama &amp; circles</p>
        <h1>Your groups</h1>
        <p className="lead" style={{ maxWidth: 560 }}>Each group has one dedicated home — roster, activity and governance. Money lives in its Treasury, not scattered here.</p>
      </header>

      {memberships.length === 0 ? (
        <div className="mcard mcard--premium" style={{ marginBottom: 16, textAlign: 'center', padding: '28px 20px' }}>
          <div className="mempty" style={{ padding: '8px 0 0' }}>
            <span className="ico" style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--green-t)', color: 'var(--green)', border: '1px solid #CDE8D9' }}><Icon name="users" size={26} /></span>
            <h2 style={{ marginBottom: 7, fontSize: '1.05rem' }}>You are not in a group yet</h2>
            <p style={{ margin: '0 auto', maxWidth: 420, color: 'var(--tx-2)', fontSize: '.92rem', lineHeight: 1.5 }}>
              If your chama is already on Esoqo, its treasurer can add you by phone. Otherwise, start one below — you become its chairperson and first signatory instantly.
            </p>
            <p style={{ margin: '14px 0 0', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '.82rem', color: 'var(--tx-2)', background: 'var(--paper)', border: '1px solid var(--line)', padding: '7px 12px', borderRadius: 999 }}>
              <Icon name="keypad" size={13} /> Dial <strong className="mono" style={{ color: 'var(--navy)' }}>*483*77#</strong> → 4 to ask
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="premium-stats" aria-label="Groups at a glance">
            <div className="pstat"><span className="pstat-k">Groups</span><span className="pstat-v">{memberships.length}</span><span className="pstat-h">{memberships.filter((m) => m.status === 'PENDING').length ? `${memberships.filter((m) => m.status === 'PENDING').length} pending join fee` : 'All active'}</span></div>
            <div className="pstat"><span className="pstat-k">Your role</span><span className="pstat-v" style={{ fontSize: '.98rem' }}>{memberships[0] ? (memberships[0].role === 'OTHER' ? (memberships[0].customRole || 'Other') : memberships[0].role.toLowerCase()) : '—'}</span><span className="pstat-h">Primary group</span></div>
            <div className="pstat"><span className="pstat-k">Treasury</span><span className="pstat-v" style={{ fontSize: '.92rem' }}>Separate</span><span className="pstat-h">One vault per group</span></div>
          </div>
          <div className="group-grid">
            {memberships.map((m) => {
              const name = m.org.knownAs || m.org.officialName;
              const initial = name.trim().charAt(0).toUpperCase() || 'G';
              return (
                <Link key={m.orgId} href={`/me/group/${m.orgId}` as Route} className="group-card">
                  <span className="group-monogram" aria-hidden="true">{initial}</span>
                  <span className="group-card-t">
                    <strong>{name} {m.status === 'PENDING' && <span className="badge b-warn" style={{ marginLeft: 6, verticalAlign: 'middle' }}>Pending</span>}</strong>
                    <small>{m.role === 'OTHER' ? (m.customRole || 'Other') : m.role.toLowerCase()} · {m.org.party.county} · {m.org._count.members} members</small>
                  </span>
                  <Icon name="chevron-right" size={16} style={{ color: 'var(--tx-3)', flex: 'none' }} />
                </Link>
              );
            })}
          </div>
        </>
      )}

      <CreateGroupForm kindOptions={GROUP_KIND_OPTIONS} />
    </>
  );
}
