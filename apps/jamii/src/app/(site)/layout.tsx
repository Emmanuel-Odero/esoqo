import { getCtx } from '@/lib/session';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  return (
    <>
      <SiteHeader signedIn={ctx.actorType === 'SUBJECT'} />
      {children}
      <SiteFooter />
    </>
  );
}
