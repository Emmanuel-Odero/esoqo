import { redirect } from 'next/navigation';
import { listMyStores } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { DashSidebar } from '@/components/DashSidebar';

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSubject();
  const stores = await listMyStores(ctx);

  // Foundation phase: the dashboard shell is scoped to one store per
  // merchant. listMyStores supports many — a store switcher is a later
  // addition, not a schema change.
  if (stores.length === 0) redirect('/dashboard/new');
  const store = stores[0]!;

  return (
    <div className="dash">
      <DashSidebar store={{ name: store.name, slug: store.slug }} />
      <div className="dash-main">{children}</div>
    </div>
  );
}
