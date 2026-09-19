import { requireOrgAccess } from '@/lib/session';
import { ScanForm } from './ScanForm';

export const dynamic = 'force-dynamic';

export default async function OrgScan({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireOrgAccess(orgId);

  return (
    <>
      <div className="mehead">
        <h1>Scan tickets</h1>
        <p>Scan or type each ticket's code once, at the door.</p>
      </div>
      <ScanForm orgId={orgId} />
    </>
  );
}
