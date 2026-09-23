import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Icon } from '@esoqo/ui';
import { requireStaff } from '@/lib/session';
import { actionGetParcelOrgDetail } from '../../../actions';
import { LabelWorkspace } from '../../../labels/LabelWorkspace';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Company labels',
  robots: { index: false, follow: false },
};

/**
 * A company's own label workspace — the drill-in from its "Labels"
 * summary card on the company page. Same Mint/Register/Batches tabs
 * the cross-company `/parcels/labels` page uses (see LabelWorkspace),
 * just pre-scoped and with the org switcher locked, since the whole
 * page is already this one company's.
 */
export default async function CompanyLabelsPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ code?: string; state?: string; batch?: string; tab?: string }>;
  },
) {
  await requireStaff();
  const { id } = await params;
  const { code, state, batch, tab } = await searchParams;

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
          <h1 style={{ margin: '6px 0 2px' }}>Labels</h1>
        </div>
      </div>
      <LabelWorkspace
        basePath={`/parcels/companies/${id}/labels`} orgId={id} lockOrg
        code={code} state={state} batch={batch} tab={tab}
      />
    </>
  );
}
