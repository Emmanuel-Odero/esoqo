import { PayNav } from './PayNav';

/**
 * Wraps every /pay route with the section mini-menu, so business, group,
 * transport, parking and help are one tap apart rather than a trip back
 * to the hub.
 *
 * The one route this also covers that it should not really is
 * /pay/<esoqo-handle>, the short link a printed QR points at. That page is a
 * meta refresh, so the menu is on screen for the moment between arriving
 * and being forwarded — harmless, and not worth a second layout tree to
 * avoid.
 */
export default function PayLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PayNav />
      {children}
    </>
  );
}
