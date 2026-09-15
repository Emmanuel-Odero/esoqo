import { DashboardShell } from '@/components/Shell';
import { getCtx } from '@/lib/session';
import '@esoqo/ui/tokens.css';
import '../admin.css';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  return (
    <DashboardShell capabilities={ctx.capabilities} actorId={ctx.actorId}>
      {children}
    </DashboardShell>
  );
}
