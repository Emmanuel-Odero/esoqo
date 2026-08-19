import { getCtx } from '@/lib/session';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { isCustomDomainRequest } from '@/lib/org-links';

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [ctx, onCustomDomain] = await Promise.all([getCtx(), isCustomDomainRequest()]);

  // A group's own domain gets no "Our Jamii"/CECF chrome at all — the
  // org page (OrgSectionShell, in custom-domain mode) renders its own
  // full site header/footer instead. See OrgTopNav/OrgFooter.
  if (onCustomDomain) return <>{children}</>;

  return (
    <>
      <SiteHeader signedIn={ctx.actorType === 'SUBJECT'} />
      {children}
      <SiteFooter />
    </>
  );
}
