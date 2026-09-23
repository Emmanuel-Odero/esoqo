import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Icon } from '@esoqo/ui';
import { requireStaff } from '@/lib/session';
import { actionGetParcelOrgDetail } from '../../../actions';
import { TeamManager } from '../../CompanyPanels';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Company team',
  robots: { index: false, follow: false },
};

/**
 * A company's roster — the drill-in from its "Team" summary card.
 * Same TeamManager the company page used to always render inline;
 * now it only loads when someone actually clicks through to manage it.
 */
export default async function CompanyTeamPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireStaff();
  const canEdit = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.edit');
  const { id } = await params;

  let detail: Awaited<ReturnType<typeof actionGetParcelOrgDetail>>;
  try {
    detail = await actionGetParcelOrgDetail(id);
  } catch {
    notFound();
  }

  return (
    <>
      <div className="head">
        <div>
          <Link href={`/parcels/companies/${id}`} className="sub"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <Icon name="arrow-left" size={14} />{detail.org.name}
          </Link>
          <h1 style={{ margin: '6px 0 2px' }}>Team</h1>
        </div>
      </div>
      <div className="card">
        <TeamManager org={detail.org} initialStaff={detail.staff} canEdit={canEdit} />
      </div>
    </>
  );
}
