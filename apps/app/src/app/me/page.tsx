import Link from 'next/link';
import type { Route } from 'next';
import { cookies } from 'next/headers';
import { Icon, type IconName } from '@esoqo/ui';
import { SESSION_COOKIE } from '@esoqo/auth';
import { getMyRecord, getGroupBalance, listMyConsents, PAYMENT_APPROVAL_THRESHOLD } from '@esoqo/db';
import { formatMsisdn } from '@esoqo/domain';
import { requireSubject } from '@/lib/session';
import { listWorkspaces } from '@/lib/workspaces';
import { goUrl, type GoMyBooking } from '@/lib/ticketing';
import { enterParcelOrg } from '@/app/workspace-actions';

export const dynamic = 'force-dynamic';

/**
 * Dashboard home — the person's record at a glance.
 *
 * Four layers of intent, in the order somebody actually asks them:
 *  1. "Where am I?"        — the greeting band, which also holds the
 *                            standing meter: X of 5 papers confirmed.
 *  2. "What do I do next?" — one primary CTA plus the quick-action row,
 *                            the four jobs people come back for.
 *  3. "How are things?"    — the KPI tiles, every one a door.
 *  4. "Where else do I work?" — the workspaces card, the same list the
 *                            header switcher carries, spelled out once
 *                            here so it's discoverable the first time.
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

const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;

/**
 * Time of day in Nairobi, not on the server. A dashboard that says "good
 * evening" at 9am because the box runs UTC undoes in one word the care
 * everything else on the page takes.
 */
function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi', hour: 'numeric', hour12: false,
    }).format(new Date()),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

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

  // listWorkspaces() is already resolved for the header switcher — the
  // cache() around it makes this a free read, not a second round trip.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const [balance, grants, workspaces, bookings] = await Promise.all([
    orgId ? getGroupBalance(ctx, orgId) : Promise.resolve(null),
    listMyConsents(ctx),
    listWorkspaces(),
    // Best-effort: the "Coming up" strip below. A failed bookings read
    // degrades to no strip, never a failed dashboard.
    (token
      ? fetch(goUrl('/v1/me/bookings'), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
          .then((r) => (r.ok ? r.json() : { bookings: [] }))
          .then((j) => ((j?.bookings ?? []) as GoMyBooking[]))
          .catch(() => [] as GoMyBooking[])
      : Promise.resolve([] as GoMyBooking[])),
  ]);

  const confirmed = CREDENTIALS.filter(([t]) => has(t)).length;
  const total = CREDENTIALS.length;
  const activeGrants = grants.filter((g) => !g.revokedAt && g.expiresAt > new Date());
  const docs = me.documents ?? [];
  const docCount = docs.length;
  const docPending = docs.filter((d) => d.status === 'PENDING_REVIEW').length;
  const otherWorkspaces = workspaces.filter((w) => w.kind !== 'personal');

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

  // The four jobs people come back for. Group leads when they have one
  // (money is why they open the app); otherwise the record itself does.
  const quick: { href: Route; icon: IconName; label: string; hint: string }[] = [
    ...(membership
      ? [{
          href: `/me/group/${orgId}/treasury` as Route,
          icon: 'bank' as const,
          label: 'Treasury',
          hint: 'Contribute or withdraw',
        }]
      : []),
    { href: '/me/tickets', icon: 'qr', label: 'Tickets', hint: 'Show a travel pass' },
    { href: '/me/documents', icon: 'document', label: 'Documents', hint: 'Upload or check one' },
    { href: '/me/vouchers', icon: 'tag', label: 'Vouchers', hint: 'Discounts and loyalty' },
  ];

  return (
    <>
      {/* ── greeting + standing, one band ──
          These used to be two stacked blocks saying almost the same
          thing: a page title, then a card whose only job was the ring.
          One band states where you are, how full the record is, and the
          single next thing worth doing. */}
      <section className="me-hero" aria-label="Your standing">
        <div className="me-hero-copy">
          <p className="kicker">{greeting()}, {givenName}</p>
          <h1>Your record</h1>
          <p className="me-hero-lead">
            Everything Esoqo holds about you — nobody else sees any of it unless you say so.
          </p>
          <Link href={primaryCta.href} className="btn btn-p btn-sm me-hero-cta">
            {primaryCta.label} <Icon name="arrow-right" size={15} />
          </Link>
        </div>

        <div className="me-meter">
          <span className="ring" role="img" aria-label={`${confirmed} of ${total} papers confirmed`}>
            <svg width="70" height="70" viewBox="0 0 70 70" aria-hidden="true">
              <circle cx="35" cy="35" r={RING_R} fill="none" stroke="var(--line)" strokeWidth="7" />
              <circle
                cx="35" cy="35" r={RING_R} fill="none"
                stroke="var(--green)" strokeWidth="7" strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - confirmed / total)}
                style={{ transition: 'stroke-dashoffset .6s var(--ease-out)' }}
              />
            </svg>
            <span className="ring-label">{confirmed}/{total}</span>
          </span>
          <div className="me-meter-copy">
            <strong>Standing</strong>
            <span>
              {confirmed === total
                ? 'Every paper Esoqo can confirm is in place.'
                : `${total - confirmed} still to confirm`}
            </span>
          </div>
        </div>
      </section>

      {/* ── the jobs, before the numbers ── */}
      <nav className="quick-row" aria-label="Common tasks">
        {quick.map((q) => (
          <Link key={q.href} href={q.href} className="quick">
            <span className="quick-ic"><Icon name={q.icon} size={18} /></span>
            <span className="quick-t">
              <strong>{q.label}</strong>
              <small>{q.hint}</small>
            </span>
            <Icon name="chevron-right" size={16} className="quick-go" />
          </Link>
        ))}
      </nav>

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

      {/* ── coming up: the week ahead, not the archive ──
          The dashboard knew balances and papers but never answered "what
          have I got on". Next two departures + anything awaiting payment,
          newest first; nothing when there's nothing. */}
      {(() => {
        const now = Date.now();
        const upcomingTrips = bookings
          .filter((b) => new Date(b.departAt).getTime() >= now && b.status !== 'CANCELLED' && b.status !== 'REFUNDED')
          .sort((a, b) => +new Date(a.departAt) - +new Date(b.departAt))
          .slice(0, 2);
        const owing = bookings.filter((b) => b.status === 'PENDING_PAYMENT' || b.status === 'PARTIALLY_PAID').slice(0, 2);
        if (upcomingTrips.length === 0 && owing.length === 0) return null;
        return (
          <section className="mcard me-coming" aria-label="Coming up">
            <h2><Icon name="calendar" size={18} />Coming up</h2>
            <ul className="coming-list">
              {upcomingTrips.map((b) => (
                <li key={b.id}>
                  <span className="coming-ic"><Icon name={b.vertical === 'TRANSPORT' ? 'truck' : 'calendar'} size={15} /></span>
                  <span className="coming-t">
                    <strong>{b.listingTitle}</strong>
                    <small>{new Date(b.departAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {b.orgName}</small>
                  </span>
                  <Link className="btn btn-o btn-sm" href="/me/tickets">Open</Link>
                </li>
              ))}
              {owing.map((b) => {
                const balanceDue = Math.max(0, Number(b.totalKes) - Number(b.amountPaidKes));
                return (
                  <li key={`owe-${b.id}`} className="is-owe">
                    <span className="coming-ic owe"><Icon name="coins" size={15} /></span>
                    <span className="coming-t">
                      <strong>KES {balanceDue.toLocaleString('en-KE')} still to pay</strong>
                      <small>{b.listingTitle} · {b.orgName}</small>
                    </span>
                    <Link className="btn btn-o btn-sm" href="/me/tickets">Pay</Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })()}

      {/* ── where else you work ──
          Courier companies and ticket organisers in one list, because to
          the person they are the same fact: somewhere other than here
          that they can be. The header switcher does this from every
          screen; this card is how somebody finds out it exists. */}
      {otherWorkspaces.length > 0 && (
        <section className="mcard" aria-label="Where you work">
          <h2><Icon name="grid" size={18} />Where you work</h2>
          {companyError && (
            <p className="err" role="alert" style={{ margin: '0 0 10px' }}>
              <Icon name="alert-circle" size={14} /> We couldn&rsquo;t open that company just now. Try again.
            </p>
          )}
          <p className="mcard-lede">
            Your record and these are separate places, and you stay signed in to all of them.
            Cross between them any time from the name at the top of the screen.
          </p>
          <ul className="wsl">
            {otherWorkspaces.map((w) => (
              <li className="wsl-row" key={w.key}>
                <span className={`wsw-mark wsw-${w.kind}`} aria-hidden="true">
                  <Icon name={w.kind === 'courier' ? 'truck' : 'calendar'} size={16} />
                </span>
                <span className="wsl-id">
                  <strong>{w.name}</strong>
                  <small>{w.note ? `${w.subtitle} · ${w.note}` : w.subtitle}</small>
                </span>
                {!w.enterable ? (
                  <span className="badge b-warn">Not trading yet</span>
                ) : w.href ? (
                  <Link className="btn btn-o btn-sm" href={w.href as Route}>
                    Open <Icon name="arrow-right" size={15} />
                  </Link>
                ) : (
                  <form action={enterParcelOrg.bind(null, w.id)}>
                    <button type="submit" className="btn btn-o btn-sm">
                      Open <Icon name="arrow-right" size={15} />
                    </button>
                  </form>
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
      {/* Paired only when there IS a group — a lone half-width card
          beside an empty column reads as something that failed to
          load. */}
      <div className={membership ? 'dash-cols' : undefined}>
        <section className="mcard">
          <h2><Icon name="eye" size={18} />Who can see this</h2>
          <p className="mcard-lede">
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
            <p className="mcard-lede">
              {membership.org.officialName} ·{' '}
              {membership.role === 'OTHER' ? (membership.customRole || 'Other') : membership.role.toLowerCase()} ·{' '}
              {membership.org._count.members} members ·{' '}
              <span className="mono">KES {(balance ?? 0).toLocaleString('en-KE')}</span> held
            </p>
            <div className="row">
              <Link className="btn btn-p btn-sm" href={`/me/group/${membership.orgId}/treasury` as Route}>
                <Icon name="bank" size={16} />Open treasury
              </Link>
              <Link className="btn btn-o btn-sm" href={`/me/group/${membership.orgId}` as Route}>
                <Icon name="users" size={16} />Group details
              </Link>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
