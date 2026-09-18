'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The parcels section's own mini-menu.
 *
 * The global header treats Parcels as one destination, but a visitor who
 * lands on the hub is really choosing between four jobs — send, track,
 * find a point, get help — and the only way to move between them was to
 * go back to the hub each time. This strip makes those parts visible and
 * one tap apart, and stays put as you scroll a long form.
 */
const LINKS = [
  ['/parcels', 'Overview'],
  ['/parcels/send', 'Send a parcel'],
  ['/parcels/track', 'Track a parcel'],
  ['/parcels/points', 'Drop-off & pickup'],
  ['/parcels/help', 'Help'],
] as const;

export function ParcelsNav() {
  const path = usePathname();

  return (
    <nav className="snav-wrap" aria-label="Parcels">
      <div className="snav">
        <div className="wrap">
          <div className="snav-in">
            {LINKS.map(([href, label]) => {
              const active = href === '/parcels'
                ? path === '/parcels'
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
