import Link from 'next/link';
import type { Route } from 'next';
import { cookies } from 'next/headers';
import { Icon, type IconName } from '@esoqo/ui';
import { SESSION_COOKIE } from '@esoqo/auth';
import {
  getMyRecord,
  getGroupBalance,
  getWalletBalance,
  listMyConsents,
  PAYMENT_APPROVAL_THRESHOLD,
} from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { orgSlug } from '@/lib/groupSlug';
import { listWorkspaces } from '@/lib/workspaces';
import { goUrl, type GoMyBooking } from '@/lib/ticketing';
import { enterOrg } from '@/app/workspace-actions';

export const dynamic = 'force-dynamic';

/**
 * Home — minimal, in priority order:
 *  1. Mast: who you are + one next step (one tap)
 *  2. Needs you today (trips / pay) — only when there is something
 *  3. Quick: the 3–4 places you tap most, plain language
 *  4. Aside: your money & status, always visible on desktop
 *  5. Where you work — discoverable, not noisy
 *
 * Language is kept plain and verb-led so a first-time user in a bright
 * market gets it without learning product jargon.
 */
function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi',
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ companyError?: string }>;
}) {
  const { companyError } = await searchParams;
  const ctx = await requireSubject();
  const me = await getMyRecord(ctx);
  if (!me) return <p>Profile not found.</p>;

  const p = me.person!;
  const membership = me.memberships[0];
  const orgId = membership?.orgId ?? null;
  const groupSlug = membership ? orgSlug(membership.org.officialName, membership.orgId) : null;

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const [balance, walletBalance, grants, workspaces, bookings] = await Promise.all([
    orgId ? getGroupBalance(ctx, orgId) : Promise.resolve(null),
    getWalletBalance(ctx),
    listMyConsents(ctx),
    listWorkspaces(),
    token
      ? fetch(goUrl('/v1/me/bookings'), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
          .then((r) => (r.ok ? r.json() : { bookings: [] }))
          .then((j) => ((j?.bookings ?? []) as GoMyBooking[]))
          .catch(() => [] as GoMyBooking[])
      : Promise.resolve([] as GoMyBooking[]),
  ]);

  const activeGrants = grants.filter((g) => !g.revokedAt && g.expiresAt > new Date());
  const otherWorkspaces = workspaces.filter((w) => w.kind !== 'personal');

  const pay = me.registration?.payment;
  const payApproved = (pay?.approvals ?? []).filter((a) => a.decision === 'APPROVE').length;
  const givenName = (p.knownAs || p.officialName || 'friend').split(' ')[0];

  let payTitle: string;
  let payHint: string;
  if (!pay || pay.status === 'NOT_DECLARED') {
    payTitle = 'Not yet';
    payHint = 'Pay when ready';
  } else if (pay.status === 'CONFIRMED' || pay.status === 'WAIVED') {
    payTitle = 'Confirmed';
    payHint = pay.amountKes ? `KES ${Number(pay.amountKes).toLocaleString('en-KE')} received` : 'Received';
  } else if (pay.status === 'REJECTED') {
    payTitle = 'Not found';
    payHint = 'We could not match it';
  } else {
    payTitle = 'Checking';
    payHint = `${payApproved} of ${PAYMENT_APPROVAL_THRESHOLD} checks done`;
  }

  const primaryCta = membership
    ? {
        label: 'Open group balance',
        hint: `Group balance KES ${(balance ?? 0).toLocaleString('en-KE')}`,
        href: `/me/group/${groupSlug}/treasury` as Route,
      }
    : {
        label: bookings.length > 0 ? 'View your tickets' : 'Find tickets',
        hint: bookings.length > 0 ? `${bookings.length} booking${bookings.length === 1 ? '' : 's'}` : 'Events & transport',
        href: '/me/tickets' as Route,
      };

  const quick: { href: Route; icon: IconName; label: string; hint: string; ariaLabel: string }[] = [
    ...(membership
      ? [
          {
            href: `/me/group/${groupSlug}/treasury` as Route,
            icon: 'bank' as const,
            label: 'Group balance',
            hint: 'Pay in or request',
            ariaLabel: `Group balance, KES ${(balance ?? 0).toLocaleString('en-KE')}`,
          },
        ]
      : []),
    {
      href: '/me/wallet' as Route,
      icon: 'bank',
      label: 'Wallet',
      hint: `KES ${walletBalance.toLocaleString('en-KE')} available`,
      ariaLabel: `Wallet, KES ${walletBalance.toLocaleString('en-KE')} available`,
    },
    {
      href: '/me/tickets' as Route,
      icon: 'qr',
      label: 'My tickets',
      hint: bookings.length ? `${bookings.length} booking${bookings.length === 1 ? '' : 's'}` : 'Your trips',
      ariaLabel: `My tickets, ${bookings.length} bookings`,
    },
    {
      href: '/me/settings' as Route,
      icon: 'grid',
      label: 'Settings',
      hint: 'Your details',
      ariaLabel: 'Settings, your details and privacy',
    },
  ];

  const needsToday = (() => {
    const now = Date.now();
    const upcoming = bookings
      .filter((b) => new Date(b.departAt).getTime() >= now && b.status !== 'CANCELLED' && b.status !== 'REFUNDED')
      .sort((a, b) => +new Date(a.departAt) - +new Date(b.departAt))
      .slice(0, 2);
    const owing = bookings.filter((b) => b.status === 'PENDING_PAYMENT' || b.status === 'PARTIALLY_PAID').slice(0, 2);
    return { upcoming, owing, hasAny: upcoming.length > 0 || owing.length > 0 };
  })();

  return (
    <>
      {/* Mast — type on paper, not a box. One line says where, one says next. */}
      <header className="me-mast" aria-label="Welcome">
        <div className="me-mast-copy">
          <p className="kicker">
            {greeting()}, {givenName}
          </p>
          <h1>Home</h1>
          <p className="me-mast-lead">Your balance, trips, and groups — all in one place.</p>
        </div>
        <Link
          href={primaryCta.href}
          className="btn btn-p me-mast-cta"
          aria-label={`${primaryCta.label}, ${primaryCta.hint}`}
        >
          {primaryCta.label} <Icon name="arrow-right" size={15} aria-hidden="true" />
        </Link>
      </header>

      <div className="me-grid">
        <div className="me-main">
          {needsToday.hasAny && (
            <section className="mcard me-coming" aria-label="Needs your attention">
              <h2>
                <Icon name="calendar" size={16} aria-hidden="true" /> Needs your attention
              </h2>
              <ul className="coming-list">
                {needsToday.upcoming.map((b) => (
                  <li key={b.id}>
                    <span className="coming-ic" aria-hidden="true">
                      <Icon name={b.vertical === 'TRANSPORT' ? 'truck' : 'calendar'} size={14} />
                    </span>
                    <span className="coming-t">
                      <strong>{b.listingTitle}</strong>
                      <small>
                        {new Date(b.departAt).toLocaleString('en-KE', {
                          timeZone: 'Africa/Nairobi',
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}{' '}
                        · {b.orgName}
                      </small>
                    </span>
                    <Link className="btn btn-o btn-sm" href="/me/tickets" aria-label={`Open ticket ${b.listingTitle}`}>
                      Open
                    </Link>
                  </li>
                ))}
                {needsToday.owing.map((b) => {
                  const due = Math.max(0, Number(b.totalKes) - Number(b.amountPaidKes));
                  return (
                    <li key={`owe-${b.id}`} className="is-owe">
                      <span className="coming-ic owe" aria-hidden="true">
                        <Icon name="coins" size={14} />
                      </span>
                      <span className="coming-t">
                        <strong>KES {due.toLocaleString('en-KE')} to pay</strong>
                        <small>
                          {b.listingTitle} · {b.orgName}
                        </small>
                      </span>
                      <Link className="btn btn-o btn-sm" href="/me/tickets" aria-label={`Pay KES ${due.toLocaleString('en-KE')} for ${b.listingTitle}`}>
                        Pay
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <nav className="quick-row" aria-label="Primary actions">
            {quick.map((q) => (
              <Link key={q.href} href={q.href} className="quick" aria-label={q.ariaLabel}>
                <span className="quick-ic" aria-hidden="true">
                  <Icon name={q.icon} size={16} />
                </span>
                <span className="quick-t">
                  <strong>{q.label}</strong>
                  <small>{q.hint}</small>
                </span>
                <Icon name="chevron-right" size={14} className="quick-go" aria-hidden="true" />
              </Link>
            ))}
          </nav>

          {otherWorkspaces.length > 0 && (
            <section className="mcard" aria-label="Your workplaces">
              <h2>
                <Icon name="grid" size={16} aria-hidden="true" /> Your workplaces
              </h2>
              {companyError && (
                <p className="err" role="alert" style={{ margin: '0 0 8px' }}>
                  <Icon name="alert-circle" size={13} aria-hidden="true" /> Couldn&apos;t open that workplace. Try again.
                </p>
              )}
              <p className="mcard-lede">Switch anytime from the name at the top — you stay signed in everywhere.</p>
              <ul className="wsl">
                {otherWorkspaces.map((w) => (
                  <li className="wsl-row" key={w.key}>
                    <span className={`wsw-mark wsw-${w.kind}`} aria-hidden="true">
                      <Icon name={w.orgType === 'courier' ? 'truck' : 'calendar'} size={14} />
                    </span>
                    <span className="wsl-id">
                      <strong>{w.name}</strong>
                      <small>{w.note ? `${w.subtitle} · ${w.note}` : w.subtitle}</small>
                    </span>
                    {!w.enterable ? (
                      <span className="badge b-warn">Not ready</span>
                    ) : w.href ? (
                      <Link className="btn btn-o btn-sm" href={w.href as Route} aria-label={`Open ${w.name}`}>
                        Open <Icon name="arrow-right" size={14} aria-hidden="true" />
                      </Link>
                    ) : (
                      <form action={enterOrg.bind(null, w.id, w.orgType ?? 'courier')}>
                        <button type="submit" className="btn btn-o btn-sm" aria-label={`Open ${w.name}`}>
                          Open <Icon name="arrow-right" size={14} aria-hidden="true" />
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {membership && (
            <section className="mcard" aria-label="Your group">
              <h2>
                <Icon name="users" size={16} aria-hidden="true" /> Your group
              </h2>
              <p className="mcard-lede">
                {membership.org.officialName} · {membership.role === 'OTHER' ? membership.customRole || 'Other' : membership.role.toLowerCase()} ·{' '}
                {membership.org._count.members} members · <span className="mono">KES {(balance ?? 0).toLocaleString('en-KE')}</span> held
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Link className="btn btn-p btn-sm" href={`/me/group/${groupSlug}/treasury` as Route} aria-label={`Open group balance for ${membership.org.officialName}`}>
                  <Icon name="bank" size={15} aria-hidden="true" /> Group balance
                </Link>
                <Link className="btn btn-o btn-sm" href={`/me/group/${groupSlug}` as Route} aria-label={`View details for ${membership.org.officialName}`}>
                  <Icon name="users" size={15} aria-hidden="true" /> Details
                </Link>
              </div>
            </section>
          )}
        </div>

        <aside className="me-aside" aria-label="Overview">
          <section className="desk-card" aria-label="At a glance">
            <h3>
              <Icon name="grid" size={14} aria-hidden="true" /> At a glance
            </h3>
            <div className="desk-kpi">
              <Link className="desk-kpi-row" href="/me/wallet" aria-label={`Wallet, KES ${walletBalance.toLocaleString('en-KE')}`}>
                <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }} aria-hidden="true">
                  <Icon name="bank" size={14} />
                </span>
                <span className="desk-kpi-t">
                  <strong>Wallet</strong>
                  <small>Wallet · vouchers · bills</small>
                </span>
                <span className="desk-kpi-v mono" aria-hidden="true">
                  {walletBalance.toLocaleString('en-KE')}
                </span>
              </Link>
              {membership && (
                <Link
                  className="desk-kpi-row"
                  href={`/me/group/${groupSlug}/treasury` as Route}
                  aria-label={`Group balance, KES ${(balance ?? 0).toLocaleString('en-KE')}`}
                >
                  <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }} aria-hidden="true">
                    <Icon name="bank" size={14} />
                  </span>
                  <span className="desk-kpi-t">
                    <strong>Group balance</strong>
                    <small>Your group&apos;s balance</small>
                  </span>
                  <span className="desk-kpi-v mono" aria-hidden="true">
                    {(balance ?? 0).toLocaleString('en-KE')}
                  </span>
                </Link>
              )}
              <Link className="desk-kpi-row" href="/me/payments" aria-label={`Registration fee, ${payTitle}, ${payHint}`}>
                <span className="icbox" style={{ background: 'var(--amber-t)', color: 'var(--amber)' }} aria-hidden="true">
                  <Icon name="coins" size={14} />
                </span>
                <span className="desk-kpi-t">
                  <strong>Registration fee</strong>
                  <small>{payHint}</small>
                </span>
                <span className="desk-kpi-v" style={{ fontSize: '.76rem' }} aria-hidden="true">
                  {payTitle}
                </span>
              </Link>
              <Link className="desk-kpi-row" href="/me/consents" aria-label={`Privacy, ${activeGrants.length ? `${activeGrants.length} active` : 'No one can see your info'}`}>
                <span className="icbox" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }} aria-hidden="true">
                  <Icon name="eye" size={14} />
                </span>
                <span className="desk-kpi-t">
                  <strong>Privacy</strong>
                  <small>Who can see your info</small>
                </span>
                <span className="desk-kpi-v" style={{ fontSize: '.76rem' }} aria-hidden="true">
                  {activeGrants.length ? `${activeGrants.length} active` : 'Private'}
                </span>
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
