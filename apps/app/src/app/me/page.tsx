import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import { getMyRecord, getGroupBalance, listMyConsents, PAYMENT_APPROVAL_THRESHOLD } from '@esoqo/db';
import { formatMsisdn } from '@esoqo/domain';
import { requireSubject } from '@/lib/session';
import { getMyParcelOrgs } from '@/lib/my-parcel-orgs';
import { enterParcelOrg } from './parcel-org-actions';

export const dynamic = 'force-dynamic';

/**
 * Dashboard home — the person's record at a glance.
 *
 * Three layers of intent:
 *  1. "How am I doing?"   — the standing ring: X of 5 papers confirmed.
 *  2. "What can I act on?" — contextual tiles + a single primary CTA.
 *  3. "Who else can see?"  — the trust card, always within reach.
 *
 * The empty gaps are as legible as the entries (a record that fills in
 * is the product). Every tile is a real link; nothing leads nowhere.
 */
const CREDENTIALS: [string, string, string, string | null][] = [
  ['MSISDN_VERIFIED', 'Phone number confirmed', 'Esoqo', null],
  ['NATIONAL_ID_CONFIRMED', 'National ID confirmed', 'Esoqo', 'Needed for credit above KES 50,000'],
  ['GROUP_REGISTERED', 'Group registered', 'Ministry of Labour', 'Opens a group bank account'],
  ['BUSINESS_REGISTERED', 'Business registered', 'Business Registration Service', 'Lets you sign contracts in your own name'],
  ['KRA_PIN', 'KRA PIN', 'Kenya Revenue Authority', 'Needed for larger facilities'],
];

const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

export default async function MePage(
  { searchParams }: { searchParams: Promise<{ companyError?: string }> },
) {
  const { companyError } = await searchParams;
  const ctx = await requireSubject();
  const me = await getMyRecord(ctx);
  if (!me) return <p>Record not found.</p>;

  const p = me.person!;
  const held = me.attestations;
  const has = (t: string) => held.find((a) => a.claimType === t);
  const membership = me.memberships[0];
  const orgId = membership?.orgId ?? null;

  const [balance, grants, courierOrgs] = await Promise.all([
    orgId ? getGroupBalance(ctx, orgId) : Promise.resolve(null),
    listMyConsents(ctx),
    getMyParcelOrgs(),
  ]);

  const confirmed = CREDENTIALS.filter(([t]) => has(t)).length;
  const total = CREDENTIALS.length;
  const activeGrants = grants.filter((g) => !g.revokedAt && g.expiresAt > new Date());
  const docs = me.documents ?? [];
  const docCount = docs.length;
  const docPending = docs.filter((d) => d.status === 'PENDING_REVIEW').length;

  const pay = me.registration?.payment;
  const payApproved = (pay?.approvals ?? []).filter((a) => a.decision === 'APPROVE').length;

  const givenName = (p.knownAs || p.officialName || 'friend').split(' ')[0];

  let payTile: { v: string; h: string };
  if (!pay || pay.status === 'NOT_DECLARED') payTile = { v: 'Not recorded', h: 'Add it when you pay' };
  else if (pay.status === 'CONFIRMED' || pay.status === 'WAIVED')
    payTile = { v: 'Confirmed', h: pay.amountKes ? `KES ${Number(pay.amountKes).toLocaleString('en-KE')} received` : 'Received' };
  else if (pay.status === 'REJECTED') payTile = { v: 'Not found', h: 'We could not match it' };
  else payTile = { v: 'Being checked', h: `${payApproved} of ${PAYMENT_APPROVAL_THRESHOLD} checks done` };

  const primaryCta = membership
    ? { label: 'Open your group treasury', href: `/me/group/${orgId}/treasury` as Route }
    : confirmed < total
      ? { label: 'See your confirmations', href: '/me/documents' as const }
      : { label: 'Manage sharing', href: '/me/consents' as const };

  return (
    <>
      <div className="mehead">
        <p className="kicker">Esoqo dashboard</p>
        <h1>Your record</h1>
        <p>
          Everything Esoqo holds about {givenName} — nobody else sees any of it unless you say so.
        </p>
      </div>

      {/* ── standing: the record filling in ── */}
      <section className="standing" aria-label="Your standing">
        <span className="ring" role="img" aria-label={`${confirmed} of ${total} papers confirmed`}>
          <svg width="58" height="58" viewBox="0 0 62 62" aria-hidden="true">
            <circle cx="31" cy="31" r={RING_R} fill="none" stroke="var(--line)" strokeWidth="7" />
            <circle
              cx="31" cy="31" r={RING_R} fill="none"
              stroke="var(--green)" strokeWidth="7" strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - confirmed / total)}
              style={{ transition: 'stroke-dashoffset .6s var(--ease-out)' }}
            />
          </svg>
          <span className="ring-label">{confirmed}/{total}</span>
        </span>
        <div className="standing-copy">
          <h2>Your standing</h2>
          <p>
            {confirmed === total
              ? 'Every paper Esoqo can confirm is in place.'
              : `${total - confirmed} ${total - confirmed === 1 ? 'paper is' : 'papers are'} still to confirm — details never
                leave Esoqo without your say.`}
          </p>
        </div>
        <Link href={primaryCta.href} className="btn btn-o btn-sm">
          {primaryCta.label} <Icon name="arrow-right" size={15} />
        </Link>
      </section>

      {/* ── tap-throughs: every box is a door ── */}
      <section className="stat-grid" aria-label="At a glance">
        {membership && (
          <Link className="tile" href={`/me/group/${membership.orgId}/treasury` as Route}>
            <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
              <Icon name="bank" size={17} />
            </span>
            <span className="tile-k">Group balance</span>
            <span className="tile-v mono">KES {(balance ?? 0).toLocaleString('en-KE')}</span>
            <span className="tile-h">Open treasury</span>
          </Link>
        )}
        <Link className="tile" href="/me/documents">
          <span className="icbox" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}>
            <Icon name="document" size={17} />
          </span>
          <span className="tile-k">Documents</span>
          <span className="tile-v">{docCount === 0 ? 'None yet' : `${docCount} uploaded`}</span>
          <span className="tile-h">{docPending > 0 ? `${docPending} being checked` : 'Confirmations below'}</span>
        </Link>
        <Link className="tile" href="/me/payments">
          <span className="icbox" style={{ background: 'var(--amber-t)', color: 'var(--amber)' }}>
            <Icon name="coins" size={17} />
          </span>
          <span className="tile-k">Your payment</span>
          <span className="tile-v">{payTile.v}</span>
          <span className="tile-h">{payTile.h}</span>
        </Link>
        <Link className="tile" href="/me/consents">
          <span className="icbox" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}>
            <Icon name="eye" size={17} />
          </span>
          <span className="tile-k">Who can see</span>
          <span className="tile-v">{activeGrants.length ? `${activeGrants.length} allowed` : 'Nobody'}</span>
          <span className="tile-h">Change it any time</span>
        </Link>
      </section>

      {/* ── companies you're on the books of ──
          A courier/shipping company an admin adds you to links your
          partyId to a parcel_org_staff row, but that only lived in an
          invite text until GET /v1/me/parcel-orgs existed. The company
          console still needs its own staff sign-in (the company-scoped
          cookie), so this links to its door rather than pretending the
          subject session is enough. */}
      {courierOrgs.length > 0 && (
        <section className="mcard" aria-label="Your companies">
          <h2><Icon name="truck" size={18} />Your companies</h2>
          {companyError && (
            <p className="err" role="alert" style={{ margin: '0 0 10px' }}>
              <Icon name="alert-circle" size={14} /> We couldn't open that company just now. Try again.
            </p>
          )}
          <ul className="papers">
            {courierOrgs.map((org) => (
              <li className="paper" key={org.orgId}>
                <span className="ps ok" aria-hidden="true"><Icon name="building" size={16} /></span>
                <span className="pt">
                  <span className="t">{org.name}</span>
                  <span className="s">{org.role.toLowerCase()}</span>
                </span>
                {org.status === 'ACTIVE' ? (
                  <form action={enterParcelOrg.bind(null, org.orgId)} style={{ flex: 'none' }}>
                    <button type="submit" className="btn btn-o btn-sm">
                      Open <Icon name="arrow-right" size={15} />
                    </button>
                  </form>
                ) : (
                  <span className="badge b-warn" style={{ flex: 'none' }}>Not trading yet</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="dash-cols">
        {/* ── who you are ── */}
        <section className="mcard">
          <h2><Icon name="user" size={18} />Who you are</h2>
          <div className="mrow">
            <span className="k">Name</span>
            <span className="v">{p.knownAs || p.officialName}</span>
          </div>
          {p.knownAs && (
            <div className="mrow"><span className="k">Official name</span><span className="v">{p.officialName}</span></div>
          )}
          <div className="mrow">
            <span className="k">Phone</span>
            <span className="v mono">
              {p.msisdn ? formatMsisdn(p.msisdn) : 'No phone on file'}{' '}
              {p.msisdn && (p.msisdnVerifiedAt
                ? <span className="badge b-ok"><Icon name="check" size={11} />Confirmed</span>
                : <span className="badge b-warn">Not confirmed</span>)}
            </span>
          </div>
          {p.email && <div className="mrow"><span className="k">Email</span><span className="v">{p.email}</span></div>}
          <div className="mrow">
            <span className="k">Where you trade</span>
            <span className="v">{me.county}{me.ward ? ` · ${me.ward}` : ''}</span>
          </div>
          {me.enterprises[0] && (
            <div className="mrow"><span className="k">What you do</span><span className="v">{me.enterprises[0].workRaw}</span></div>
          )}
        </section>

        {/* ── confirmations: Esoqo's checks on your record (attestations).
            Uploaded files live separately under Documents — the tile above
            links there. This list used to sit beside a second copy of the
            same count with no pointer to Documents, so the two "papers"
            looked like the same job twice. */}
        <section className="mcard">
          <h2><Icon name="certificate" size={18} />Confirmations</h2>
          <ul className="papers">
            {CREDENTIALS.map(([type, label, issuer, opens]) => {
              const a = has(type);
              const expiring = a?.expiresAt && a.expiresAt.getTime() - Date.now() < 60 * 864e5;
              return (
                <li className="paper" key={type}>
                  <span className={`ps ${a ? (expiring ? 'soon' : 'ok') : 'gap'}`} aria-hidden="true">
                    {a
                      ? <Icon name={expiring ? 'clock' : 'check'} size={16} />
                      : <Icon name="plus" size={16} />}
                  </span>
                  <span className="pt">
                    <span className="t">{label}</span>
                    <span className="s">
                      {a
                        ? `Given by ${issuer} · ${a.issuedAt.toLocaleDateString('en-KE')}${expiring ? ' · expiring soon' : ''}`
                        : opens ?? `Issued by ${issuer}`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <Link className="btn btn-o" href="/me/documents" style={{ marginTop: 12 }}>
            <Icon name="arrow-right" size={15} />Your uploaded documents
          </Link>
        </section>
      </div>

      {/* ── trust + group: summaries only. The full grant list lives on
          /me/consents and the full membership + money on
          /me/group/[orgId] and its treasury page — this home used to
          re-render both in full, so the same permissions and the same
          group appeared twice. Tiles at the top carry the counts; these
          rows carry the doors. */}
      <section className="mcard">
        <h2><Icon name="eye" size={18} />Who can see this</h2>
        <p style={{ margin: '0 0 12px', color: 'var(--tx-2)', fontSize: '.92rem' }}>
          {activeGrants.length === 0
            ? 'Nobody. You have granted no access — not a bank, not a buyer, not a county.'
            : `${activeGrants.length} ${activeGrants.length === 1 ? 'organisation can' : 'organisations can'} see parts of your record. Change it any time.`}
        </p>
        <Link className="btn btn-o" href="/me/consents">
          <Icon name="arrow-right" size={15} />Manage permissions
        </Link>
      </section>

      {membership && (
        <section className="mcard">
          <h2><Icon name="users" size={18} />Your group</h2>
          <p style={{ margin: '0 0 12px', color: 'var(--tx-2)', fontSize: '.92rem' }}>
            {membership.org.officialName} ·{' '}
            {membership.role === 'OTHER' ? (membership.customRole || 'Other') : membership.role.toLowerCase()} ·{' '}
            {membership.org._count.members} members ·{' '}
            <span className="mono">KES {(balance ?? 0).toLocaleString('en-KE')}</span> held
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn btn-p" href={`/me/group/${membership.orgId}/treasury` as Route}>
              <Icon name="bank" size={16} />Open treasury
            </Link>
            <Link className="btn btn-o" href={`/me/group/${membership.orgId}` as Route}>
              <Icon name="users" size={16} />Group details
            </Link>
          </div>
        </section>
      )}
    </>
  );
}