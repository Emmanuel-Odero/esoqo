import { RouteAnnouncer, SkipLinks, LiveRegion } from '@esoko/a11y';
import { IconSprite } from '@esoko/ui';
import { Sidebar, TopBar } from '@/components/Shell';
import { getCtx } from '@/lib/session';
import '@esoko/ui/tokens.css';
import '../admin.css';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  return (
    <div className="shell">
      <Sidebar capabilities={ctx.capabilities} />
      <div className="col">
        <TopBar capabilities={ctx.capabilities} actorId={ctx.actorId} />
        <main id="main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
