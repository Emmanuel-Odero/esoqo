'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The payments section's own mini-menu.
 *
 * Same job as ParcelsNav, and the same reason for it: the global header
 * treats Payments as one destination, but someone who lands on the hub is
 * choosing between genuinely different jobs — pay a shop, pay into a
 * group, or find out why a payment did not work — and the only way
 * between them was a trip back to the hub each time.
 *
 * Transport and parking are deliberately absent: they belong to the
 * /transport section now, so this menu hides itself entirely on their
 * routes rather than offering payment tabs beside a parking ticket.
 *
 * Overview is deliberately first and matches only the exact hub path, so
 * that a scanned link landing on /pay/johnmutu482 does not light up
 * "Overview" as though the customer had chosen it.
 */
const LINKS = [
  ['/pay', 'Overview'],
  ['/pay/business', 'Pay a business'],
  ['/pay/group', 'Pay a group'],
  ['/pay/help', 'Help'],
] as const;

/** Routes that now belong to /transport — no payments menu here. */
const HIDDEN = ['/pay/transport', '/pay/parking'];

export function PayNav() {
  const path = usePathname();

  if (HIDDEN.some((p) => path === p || path.startsWith(`${p}/`))) return null;

  return (
    <nav className="snav-wrap" aria-label="Payments">
      <div className="snav">
        <div className="wrap">
          <div className="snav-in">
            {LINKS.map(([href, label]) => {
              const active = href === '/pay'
                ? path === '/pay'
                : path === href || path.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={active ? 'on' : undefined}
                  aria-current={active ? 'page' : undefined}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
