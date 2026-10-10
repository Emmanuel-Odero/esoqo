import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import { getMyRecord, GROUP_KINDS } from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { orgSlug } from '@/lib/groupSlug';
import { GroupCreateToggle } from './GroupCreateToggle';

const GROUP_KIND_OPTIONS = GROUP_KINDS.filter(([k]) => k !== 'BUSINESS');

export const dynamic = 'force-dynamic';

/**
 * Your groups — one glance says "which chamas am I in, what next?"
 * 1. Mast: where you are + primary CTA (Create).
 * 2. Bento: left — your groups (the treasure, tappable cards).
 *           right — why it matters + USSD fallback (sticky, never scrolling away).
 * Create form is disclosed, not always open — it doesn't compete with the list.
 */
export default async function MyGroups() {
  const ctx = await requireSubject();
  const me = await getMyRecord(ctx);
  const memberships = me?.memberships ?? [];

  return (
    <>
      <header className="me-mast" aria-label="Your groups">
        <div className="me-mast-copy">
          <p className="kicker">Your groups · {memberships.length} {memberships.length === 1 ? 'group' : 'groups'}</p>
          <h1>Chamas & circles</h1>
          <p className="me-mast-lead">Each group has one home — members, contributions, and decisions together. Tap to open.</p>
        </div>
        <GroupCreateToggle
          kindOptions={GROUP_KIND_OPTIONS}
          hasGroups={memberships.length > 0}
        />
      </header>

      {memberships.length === 0 ? (
        <div className="me-grid">
          <div className="me-main">
            <div className="mcard" style={{ textAlign: 'center', padding: '28px 18px' }}>
              <span className="ico" aria-hidden="true" style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--green-t)', color: 'var(--green)', border: '1px solid #CDE8D9', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}>
                <Icon name="users" size={24} />
              </span>
              <h2 style={{ justifyContent: 'center', marginBottom: 6 }}>No group yet</h2>
              <p style={{ margin: '0 auto', maxWidth: 420, color: 'var(--tx-2)', fontSize: '.9rem', lineHeight: 1.55 }}>
                If your chama is already on Esoqo, its treasurer can add you by phone. Otherwise create one — you become chairperson and signer immediately.
              </p>
            </div>
          </div>

          <aside className="me-aside" aria-label="How groups work">
            <section className="desk-card">
              <h3><Icon name="info" size={14} aria-hidden="true" /> How it works</h3>
              <p>Chama, table-banking, SACCO — treasury & multisig are ready at creation. No separate setup.</p>
              <p className="hint" style={{ margin: '10px 0 0', fontSize: '.82rem' }}>
                <Icon name="keypad" size={12} aria-hidden="true" /> No smartphone? Dial <strong className="mono" style={{ color: 'var(--navy)' }}>*483*77# → 4</strong> to join or check.
              </p>
            </section>
          </aside>
        </div>
      ) : (
        <div className="me-grid">
          <div className="me-main">
            <section aria-label="Your groups">
              <div className="group-grid">
                {memberships.map((m) => {
                  const name = m.org.knownAs || m.org.officialName;
                  const initial = name.trim().charAt(0).toUpperCase() || 'G';
                  const href = `/me/group/${orgSlug(name, m.orgId)}` as Route;
                  return (
                    <Link
                      key={m.orgId}
                      href={href}
                      className="group-card"
                      aria-label={`${name}, ${m.role === 'OTHER' ? m.customRole || 'other' : m.role.toLowerCase()} · ${m.org._count.members} members${m.status === 'PENDING' ? ' · pending' : ''}`}
                    >
                      <span className="group-monogram" aria-hidden="true">{initial}</span>
                      <span className="group-card-t">
                        <strong>
                          {name}{' '}
                          {m.status === 'PENDING' && <span className="badge b-warn" style={{ marginLeft: 6, verticalAlign: 'middle' }}>Pending</span>}
                        </strong>
                        <small>
                          {m.role === 'OTHER' ? m.customRole || 'Other' : m.role.toLowerCase()} · {m.org.party.county} · {m.org._count.members} members
                        </small>
                      </span>
                      <Icon name="chevron-right" size={16} aria-hidden="true" style={{ color: 'var(--tx-3)', flex: 'none' }} />
                    </Link>
                  );
                })}
              </div>
            </section>
          </div>

          <aside className="me-aside" aria-label="About groups">
            <section className="desk-card">
              <h3><Icon name="users" size={14} aria-hidden="true" /> Why groups matter</h3>
              <p>Treasury, contributions & withdrawals are per-group — not mixed here. Each card opens that group&apos;s balance.</p>
              <p className="hint" style={{ margin: '10px 0 0', fontSize: '.82rem' }}>
                <Icon name="keypad" size={12} aria-hidden="true" /> Phone only? <strong className="mono" style={{ color: 'var(--navy)' }}>*483*77# → 4</strong> does the same.
              </p>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
