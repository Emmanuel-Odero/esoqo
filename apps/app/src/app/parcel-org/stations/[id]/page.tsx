import { redirect } from 'next/navigation';
import {
  ParcelOrgUnauthorised, getParcelOrgMe, parcelOrgFetch,
  type ParcelOrgStaffRow, type ParcelOrgStationRow,
} from '@/lib/parcel-org-session';
import { listOrgStaff } from '../../actions';
import { StationDetail } from './StationDetail';

export const dynamic = 'force-dynamic';

/**
 * One station — its location on a map, the member who runs it, and the
 * team posted to it. Same capability as the station register
 * (parcelorgstation.write): this is the management view of a location,
 * not something a rider opens mid-delivery.
 */
export default async function StationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const me = await getParcelOrgMe();
    if (!me.capabilities.includes('parcelorgstation.write')) redirect('/parcel-org');

    const { station, members } = await parcelOrgFetch<{
      station: ParcelOrgStationRow;
      members: ParcelOrgStaffRow[] | null;
    }>(`/v1/parcel-orgs/me/stations/${encodeURIComponent(id)}`);

    // The posting pool: the company's roster. Best-effort — the staff
    // list needs parcelorgstaff.write, and a station manager may hold
    // only the station capability. Without it the manager still names
    // the lead but can't re-post members (StationDetail hides the
    // posting controls when canManage is false).
    const canManage = me.capabilities.includes('parcelorgstaff.write');
    const roster = canManage ? await listOrgStaff().catch(() => [] as ParcelOrgStaffRow[]) : [];

    return <StationDetail station={station} members={members ?? []} roster={roster} canManage={canManage} />;
  } catch (e) {
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }
}
