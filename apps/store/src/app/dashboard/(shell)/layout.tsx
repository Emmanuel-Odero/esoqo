import { redirect } from 'next/navigation';
import { listMyStores } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { DashSidebar } from '@/components/DashSidebar';

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSubject();
  const stores = await listMyStores(ctx);

  if (stores.length === 0) redirect('/dashboard/new');
  const store = stores[0]!;

  return (
    <div className="dash">
      <DashSidebar store={{ name: store.name, slug: store.slug }} />
      <div>
        <header className="dash-topbar">
          <span className="brand"><span className="dot" />{store.name}</span>
          <span className="user">
            <span className="avatar">{(store.name ?? 'ES').slice(0, 2).toUpperCase()}</span>
            <span className="mono" style={{ fontSize: '.72rem' }}>esoko.global/@{store.slug}</span>
          </span>
        </header>
        <main className="dash-main">{children}</main>
      </div>
    </div>
  );
}