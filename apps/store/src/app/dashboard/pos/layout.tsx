import { redirect } from 'next/navigation';
import { listMyStores } from '@esoqo/db';
import { requireStoreAccess } from '@/lib/session';
import { DashSidebar } from '@/components/DashSidebar';
import { MobileNavToggle } from '@/components/MobileNavToggle';
import { SignOutButton } from '@/components/SignOutButton';

/**
 * Deliberately its own layout, not (shell)'s — (shell) hard-requires an
 * owner subject session and redirects anyone else to /signin. A cashier
 * signed in on their own session (see /signin/cashier/[slug]) is not a
 * subject and would just bounce.
 *
 * But the owner reaches this same route too (their own "PoS terminal"
 * sidebar link), and they should never lose the dashboard chrome just
 * because a cashier might also land here — that's what happened the
 * first time this layout went bare-bones for everyone. So this checks
 * who's actually signed in and renders accordingly: the owner gets the
 * full sidebar/topbar like every other dashboard page, a cashier gets a
 * bare top bar with no Products/Settings/Reports in nav — a cashier has
 * no business seeing those even if the DAL would refuse those pages
 * anyway.
 */
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const access = await requireStoreAccess();

  if (access.kind === 'cashier') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
        <main className="dash-main" style={{ maxWidth: 1200, margin: '0 auto' }}>{children}</main>
      </div>
    );
  }

  const [store] = await listMyStores(access.ctx);
  if (!store) redirect('/dashboard/new');

  return (
    <div className="dash">
      <DashSidebar store={{ name: store.name, slug: store.slug }} />
      <div>
        <header className="dash-topbar">
          <MobileNavToggle />
          <span className="brand"><span className="dot" />{store.name}</span>
          <span className="user">
            <span className="avatar">{(store.name ?? 'ES').slice(0, 2).toUpperCase()}</span>
            <span className="slug mono" style={{ fontSize: '.72rem' }}>esoko.global/@{store.slug}</span>
            <SignOutButton />
          </span>
        </header>
        <main className="dash-main">{children}</main>
      </div>
    </div>
  );
}
