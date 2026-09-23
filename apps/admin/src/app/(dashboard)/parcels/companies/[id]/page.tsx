import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireStaff } from '@/lib/session';
import { actionGetParcelOrgDetail, actionListParcelLabelBatches } from '../../actions';
import { CompanyDetail } from './CompanyDetail';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Courier company',
  robots: { index: false, follow: false },
};

/**
 * A single courier company's page.
 *
 * The register used to expand a company inline for a glance and nothing
 * more, which made anything beyond "change the rate" a hunt. This is the
 * real surface: one company, everything about it — its numbers, its team
 * (with each member's Esoqo ID), its profile and its audit trail.
 */
export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const canEdit = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.edit');
  const { id } = await params;

  let detail: Awaited<ReturnType<typeof actionGetParcelOrgDetail>>;
  try {
    detail = await actionGetParcelOrgDetail(id);
  } catch {
    notFound();
  }

  const batches = await actionListParcelLabelBatches(id);

  return (
    <CompanyDetail detail={detail} canEdit={canEdit} labelBatches={batches} />
  );
}
