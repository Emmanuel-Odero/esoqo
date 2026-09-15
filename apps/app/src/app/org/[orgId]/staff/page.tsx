import { notFound } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { AuthorisationError } from '@esoqo/db';
import { requireOrgAccess } from '@/lib/session';
import { orgGo, type GoOrg, type GoStaff } from '@/lib/ticketing';
import { StaffForm } from './StaffForm';

export const dynamic = 'force-dynamic';

export default async function OrgStaff({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireOrgAccess(orgId);
  // Only ADMIN/owner hold ticketorgstaff.write — a MANAGER or SCANNER
  // reaching this URL directly is refused rather than crashed.
  const [org, staff] = await Promise.all([
    orgGo<{ org: GoOrg }>(orgId, `/v1/ticketorgs/${orgId}`).then((r) => r.org),
    orgGo<{ staff: GoStaff[] }>(orgId, `/v1/ticketorgs/${orgId}/staff`)
      .then((r) => r.staff)
      .catch((e) => {
        if (e instanceof AuthorisationError) notFound();
        throw e;
      }),
  ]);
  const signInUrl = `/org-staff/${org.slug}`;

  return (
    <>
      <div className="mehead">
        <h1>Staff</h1>
        <p>Who else can act on this organiser, and how much they can do.</p>
      </div>

      <div className="note n-blue" style={{ marginBottom: 16 }}>
        <div>
          <p>
            <Icon name="info" size={14} /> Staff sign in on their own device at{' '}
            <strong className="mono">{signInUrl}</strong> with their name and the PIN you set below —
            never their own Esoqo account.
          </p>
        </div>
      </div>

      <StaffForm orgId={orgId} staff={staff} />
    </>
  );
}
