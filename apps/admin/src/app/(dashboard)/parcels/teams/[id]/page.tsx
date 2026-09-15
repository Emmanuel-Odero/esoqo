import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { actionGetCourierTeam } from '../../actions';
import { TeamDetail } from './TeamDetail';

export const dynamic = 'force-dynamic';

export default async function CourierTeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const canManage = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.couriers.manage');
  const { id } = await params;
  const team = await actionGetCourierTeam(id);
  if (!team) notFound();

  return (
    <>
      <div className="head">
        <div>
          <h1>{team.name}</h1>
          <p>Roster, fleets, and each fleet&apos;s current trip.</p>
        </div>
      </div>
      <TeamDetail teamId={id} name={team.name} members={team.members} fleets={team.fleets} canManage={canManage} />
    </>
  );
}
