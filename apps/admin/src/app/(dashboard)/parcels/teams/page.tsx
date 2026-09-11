import Link from 'next/link';
import type { Route } from 'next';
import { requireStaff } from '@/lib/session';
import { actionListCourierTeams } from '../actions';
import { CreateTeamPanel } from './CreateTeamPanel';

export const dynamic = 'force-dynamic';

export default async function CourierTeamsPage() {
  const ctx = await requireStaff();
  const canManage = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.couriers.manage');
  const teams = await actionListCourierTeams();

  return (
    <>
      <div className="head">
        <div>
          <h1>Courier teams</h1>
          <p>
            A manager plus a roster, running one or more fleets (each its own fleet number).
            Assign parcels to a fleet&apos;s current trip, then mark it complete once the fleet is
            back and the packages have arrived — everyone on the team gets a text either way.
          </p>
        </div>
      </div>

      {canManage && <CreateTeamPanel />}

      <div className="card" style={{ padding: 0, marginTop: 16 }}>
        <table className="tbl">
          <thead>
            <tr><th>Team</th><th>Manager</th><th>Members</th><th>Fleets</th><th>Created</th></tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.ID}>
                <td>
                  <Link href={`/parcels/teams/${t.ID}` as Route} style={{ textDecoration: 'underline dotted' }}>{t.Name}</Link>
                </td>
                <td className="sub">{t.ManagerName ?? '—'}</td>
                <td className="sub">{t.MemberCount}</td>
                <td className="sub">{t.FleetCount}</td>
                <td className="sub">{new Date(t.CreatedAt).toLocaleDateString('en-KE')}</td>
              </tr>
            ))}
            {teams.length === 0 && (
              <tr><td colSpan={5} className="sub" style={{ textAlign: 'center', padding: 24 }}>No courier teams yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
