/**
 * Hotel Portal — Staff
 * Lists hotel staff and their roles.
 */
import { notFound } from 'next/navigation';
import { fetchOrgMe } from '@/lib/org-session';
import { hotelFetch } from '../hotel-fetch';

export const metadata = { title: 'Staff' };

interface StaffMember {
  id: string;
  name: string;
  role: string;
  active: boolean;
  isContact: boolean;
}

interface StaffResponse {
  staff: StaffMember[];
}

const ROLE_LABEL: Record<string, string> = {
  RECEPTIONIST: 'Receptionist',
  HOUSEKEEPER: 'Housekeeper',
  MANAGER: 'Manager',
};

export default async function HotelStaffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: orgId } = await params;

  const [me, staffRes] = await Promise.all([
    fetchOrgMe(orgId, 'hotel').catch(() => null),
    hotelFetch<StaffResponse>(orgId, `/v1/hotels/${orgId}/staff`).catch(() => ({ staff: [] })),
  ]);

  if (!me) notFound();

  const canWrite = me.capabilities.includes('hotel.staff.write');
  const staff = staffRes.staff ?? [];

  return (
    <main className="hotel-main">
      <div className="hotel-page-header">
        <div>
          <h1>Staff</h1>
          <p className="subtitle">{staff.length} member{staff.length !== 1 ? 's' : ''}</p>
        </div>
        {canWrite && (
          <a href={`/org/hotel/${orgId}/staff/new`} className="btn-primary">
            + Add Staff
          </a>
        )}
      </div>

      {staff.length === 0 ? (
        <div className="empty-state">
          <p>No staff members yet.</p>
          {canWrite && (
            <a href={`/org/hotel/${orgId}/staff/new`} className="btn-primary">
              Add your first staff member
            </a>
          )}
        </div>
      ) : (
        <div className="staff-table">
          <div className="staff-header">
            <span>Name</span>
            <span>Role</span>
            <span>Status</span>
            <span>Contact</span>
          </div>
          {staff.map((member) => (
            <div key={member.id} className="staff-row">
              <span className="staff-name">{member.name}</span>
              <span className="staff-role">
                {ROLE_LABEL[member.role] ?? member.role}
              </span>
              <span className={`staff-status ${member.active ? 'active' : 'inactive'}`}>
                {member.active ? 'Active' : 'Inactive'}
              </span>
              <span className="staff-contact">
                {member.isContact ? '✓ Contact' : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .hotel-main { padding: 1.5rem; max-width: 900px; }
        .hotel-page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; }
        .hotel-page-header h1 { margin: 0 0 .25rem; font-size: 1.5rem; font-weight: 700; }
        .subtitle { margin: 0; color: #6b7280; font-size: .875rem; }
        .btn-primary { padding: .5rem 1rem; background: #7c3aed; color: white; border-radius: .375rem; text-decoration: none; font-size: .875rem; font-weight: 500; }
        .empty-state { padding: 2rem; text-align: center; color: #6b7280; background: #f9fafb; border-radius: .5rem; }
        .staff-table { border: 1px solid #e5e7eb; border-radius: .5rem; overflow: hidden; }
        .staff-header, .staff-row { display: grid; grid-template-columns: 1fr 120px 80px 90px; gap: 1rem; padding: .75rem 1rem; font-size: .875rem; }
        .staff-header { background: #f9fafb; font-weight: 600; color: #374151; font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
        .staff-row { border-top: 1px solid #f3f4f6; }
        .staff-row:hover { background: #fafafa; }
        .staff-name { font-weight: 500; }
        .staff-status.active { color: #065f46; }
        .staff-status.inactive { color: #9ca3af; }
        .staff-contact { font-size: .8rem; color: #059669; }
      `}</style>
    </main>
  );
}
