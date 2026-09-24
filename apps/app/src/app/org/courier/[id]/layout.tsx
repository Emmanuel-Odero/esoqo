import type { Metadata } from 'next';
import OrgPortalShell from '@/components/OrgPortalShell';

export const metadata: Metadata = {
  title: { default: 'Courier portal', template: '%s · Esoqo' },
};

/**
 * Courier portal layout.
 *
 * /org/courier is a static route segment that wins over the dynamic
 * /org/[type] catch-all in Next.js, so courier pages resolve through this
 * directory's own layout. It renders the same shared portal shell as the
 * generic /org/[type]/[id] layout, replacing the legacy /parcel-org layout.
 */
export default async function CourierPortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id: orgId } = await params;

  return (
    <OrgPortalShell orgType="courier" orgId={orgId}>
      {children}
    </OrgPortalShell>
  );
}