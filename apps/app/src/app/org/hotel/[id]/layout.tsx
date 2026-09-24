import type { Metadata } from 'next';
import OrgPortalShell from '@/components/OrgPortalShell';

export const metadata: Metadata = {
  title: { default: 'Hotel portal', template: '%s · Esoqo' },
};

/**
 * Hotel portal layout.
 *
 * /org/hotel is a static route segment that wins over the dynamic
 * /org/[type] catch-all in Next.js, so hotel pages resolve through this
 * directory's own layout. It renders the same shared portal shell as the
 * generic /org/[type]/[id] layout.
 */
export default async function HotelPortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id: orgId } = await params;

  return (
    <OrgPortalShell orgType="hotel" orgId={orgId}>
      {children}
    </OrgPortalShell>
  );
}