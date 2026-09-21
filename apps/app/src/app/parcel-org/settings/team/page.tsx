import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { listOrgStaff } from '../../actions';
import { OrgStaffManager } from './OrgStaffManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your team — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * A courier company managing its own people — issuing a rider a PIN
 * without going through Esoqo support, which is the difference between
 * a partner who can hire on a Monday morning and one who files a
 * ticket and waits.
 *
 * Manager-only. The capability check here is UX: core-go refuses the
 * underlying routes independently for any session without
 * parcelorgstaff.write, so a hand-typed URL gets nothing either.
 */
export default async function ParcelOrgTeamPage() {
  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  let staff: Awaited<ReturnType<typeof listOrgStaff>>;
  try {
    me = await getParcelOrgMe();
    if (!me.capabilities.includes('parcelorgstaff.write')) redirect('/parcel-org');
    staff = await listOrgStaff();
  } catch (e) {
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Your team</h1>
          <p>
            Each person signs in at <span className="mono">/parcel-co/{me.org.slug}</span> with
            their own name and PIN — never a shared login.
          </p>
        </div>
      </div>

      <OrgStaffManager staff={staff} />
    </>
  );
}
