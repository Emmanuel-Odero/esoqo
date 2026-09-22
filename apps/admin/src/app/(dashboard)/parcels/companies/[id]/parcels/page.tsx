import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import type { Metadata } from 'next';
import { Icon } from '@esoqo/ui';
import { requireStaff } from '@/lib/session';
import { actionGetParcelOrgDetail, actionListParcelsForOrg } from '../../../actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Company parcels',
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 25;

/**
 * A company's own parcel ledger — the drill-in from its "Parcels"
 * summary card. A bespoke small table rather than the shared
 * ParcelsTable/Pager: those hardcode `/parcels` as their pagination
 * base path, which would silently page this company's list back out
 * to the cross-company console.
 */
export default async function CompanyParcelsPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ page?: string }>;
  },
) {
  await requireStaff();
  const { id } = await params;
  const { page } = await searchParams;

  let detail: Awaited<ReturnType<typeof actionGetParcelOrgDetail>>;
  try {
    detail = await actionGetParcelOrgDetail(id);
  } catch {
    notFound();
  }

  const pageNumber = Math.max(1, Number(page) || 1);
  const { parcels, total } = await actionListParcelsForOrg(id, {
    limit: PAGE_SIZE, offset: (pageNumber - 1) * PAGE_SIZE,
  });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="head">
        <div>
          <Link href={`/parcels/companies/${id}`} className="sub"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <Icon name="arrow-left" size={14} />{detail.org.name}
          </Link>
          <h1 style={{ margin: '6px 0 2px' }}>Parcels</h1>
          <p className="sub" style={{ margin: 0 }}>{total} parcel{total === 1 ? '' : 's'} booked through this company.</p>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {parcels.length === 0 ? (
          <p className="sub" style={{ padding: 16 }}>No parcels booked for this company yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Code</th><th>Status</th><th>Receiver</th><th>Destination</th><th>Booked</th><th />
                </tr>
              </thead>
              <tbody>
                {parcels.map((p) => (
                  <tr key={p.ID}>
                    <td className="mono">{p.Code}</td>
                    <td className="sub">{parcelStatusLabel(p.Status)}</td>
                    <td>{p.ReceiverName || <span className="sub">—</span>}</td>
                    <td className="sub">{p.DestinationLabel || '—'}</td>
                    <td className="sub" style={{ fontSize: '.8rem' }}>
                      {new Date(p.CreatedAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link className="btn btn-o btn-sm" href={`/parcels?q=${encodeURIComponent(p.Code)}` as Route}>
                        <Icon name="eye" size={13} />View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pageCount > 1 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 16, borderTop: '1px solid var(--line)' }}>
            <span className="sub">Page {pageNumber} of {pageCount}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {pageNumber > 1 && (
                <Link className="btn btn-o btn-sm" href={`/parcels/companies/${id}/parcels?page=${pageNumber - 1}` as Route}>Previous</Link>
              )}
              {pageNumber < pageCount && (
                <Link className="btn btn-o btn-sm" href={`/parcels/companies/${id}/parcels?page=${pageNumber + 1}` as Route}>Next</Link>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function parcelStatusLabel(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
