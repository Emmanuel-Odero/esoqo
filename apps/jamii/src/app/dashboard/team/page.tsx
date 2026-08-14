import { listTeamMembers } from '@esoko/db';
import { requireMyPage } from '@/lib/session';
import { TeamPanel } from './TeamPanel';

export default async function TeamScreen() {
  const { ctx, page } = await requireMyPage();
  const members = await listTeamMembers(ctx, page.organisationId);

  return (
    <>
      <h1>Team</h1>
      <p className="sub">People who can manage this page, with the access level you give them.</p>
      <TeamPanel pageId={page.organisationId} members={members} />
    </>
  );
}
