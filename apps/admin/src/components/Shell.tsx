'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@esoko/ui';

/**
 * Navigation renders from CAPABILITIES, not from a role name.
 *
 * A finance approver never sees the staff section; a viewer never sees
 * the payment queue. Hiding is a courtesy — the DAL is what actually
 * refuses — but showing someone a door they cannot open is bad design.
 */
const NAV: { group: string; items: [string, IconName, string, string][] }[] = [
  { group: 'Work', items: [
    ['/', 'chart', 'Overview', 'report.read'],
    ['/registrations', 'users', 'Registrations', 'registration.read'],
    ['/payments', 'coins', 'Payments', 'payment.read'],
    ['/documents', 'document', 'Documents', 'document.read'],
    ['/groups', 'handshake', 'Groups', 'party.read'],
  ]},
  { group: 'Governance', items: [
    ['/staff', 'shield', 'Staff & permissions', 'staff.read'],
    ['/audit', 'scales', 'Audit log', 'audit.read'],
  ]},
];

function allowed(caps: string[], need: string) {
  return caps.includes('*') || caps.some((c) => c === need || c.startsWith(`${need.split('.')[0]}.`));
}

export function Sidebar({ capabilities }: { capabilities: string[] }) {
  const path = usePathname();
  return (
    <aside id="nav" aria-label="Sections">
      <div className="brand">
        <span className="brand-mark"><Icon name="chart" size={17} /></span>
        <div>
          <strong>Esoko</strong>
          <span>Operations</span>
        </div>
      </div>
      <nav>
        {NAV.map((g) => {
          const items = g.items.filter(([, , , cap]) => allowed(capabilities, cap));
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <p className="navgroup">{g.group}</p>
              {items.map(([href, icon, label]) => (
                <Link key={href} href={href} className={path === href ? 'on' : ''}
                  aria-current={path === href ? 'page' : undefined}>
                  <Icon name={icon} size={17} />{label}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>
      <p className="env">Pilot build</p>
    </aside>
  );
}

export function TopBar({ capabilities, actorId }: { capabilities: string[]; actorId: string | null }) {
  const isSuper = capabilities.includes('*');
  return (
    <header className="topbar">
      <div className="tb-caps" title={`${capabilities.length} capabilities`}>
        <Icon name="key" size={14} />
        {isSuper ? 'Super admin' : `${capabilities.length} permissions`}
      </div>
      <div className="tb-right">
        <span className="avatar" aria-hidden="true">
          {(actorId ?? 'OP').slice(0, 2).toUpperCase()}
        </span>
        <span className="sr-only">Signed in</span>
      </div>
    </header>
  );
}
