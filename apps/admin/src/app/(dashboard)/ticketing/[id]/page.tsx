import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { getTicketOrg, listTicketOrgStaff, AuthorisationError } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { OrgStaffPanel } from './OrgStaffPanel';

export const dynamic = 'force-dynamic';

const VERTICAL_LABEL: Record<string, string> = { EVENTS: 'Events / tours', TRANSPORT: 'Transport' };
const STATUS_PILL: Record<string, string> = { ACTIVE: 'p-ok', DRAFT: 'p-warn', SUSPENDED: 'p-bad' };

export default async function TicketOrgDetail({
  params,
}: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const canManageStaff = ctx.capabilities.includes('*') || ctx.capabilities.includes('ticketorgstaff.write');

  const org = await getTicketOrg(ctx, id).catch((e) => {
    if (e instanceof AuthorisationError) notFound();
    throw e;
  });
  const staff = canManageStaff
    ? await listTicketOrgStaff(ctx, id)
    : [];

  return (
    <>
      <div className="head">
        <div>
          <Link href="/ticketing" className="sub" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <Icon name="arrow-left" size={14} />Back to organisers
          </Link>
          <h1>{org.name}</h1>
          <p>
            {VERTICAL_LABEL[org.vertical] ?? org.vertical} ·{' '}
            <span className={`pill ${STATUS_PILL[org.status]}`}>{org.status}</span>
            {org.contactPerson && <> · {org.contactPerson}</>}
            {org.contactPhone && <> ({org.contactPhone})</>}
          </p>
        </div>
      </div>

      {canManageStaff ? (
        <OrgStaffPanel orgId={id} staff={staff.map((s) => ({
          id: s.id, name: s.name, role: s.role, active: s.active,
        }))} />
      ) : (
        <div className="card">
          <p className="empty">You need <code>ticketorgstaff.write</code> to add or manage this organiser&rsquo;s staff.</p>
        </div>
      )}
    </>
  );
}
