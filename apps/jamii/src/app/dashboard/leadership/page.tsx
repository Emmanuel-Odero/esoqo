import { listMyGroupMembers, AuthorisationError } from '@esoqo/db';
import { requireMyPage } from '@/lib/session';
import { LeadershipRoster } from './LeadershipRoster';

/**
 * Editing a member's role here calls the *same* setMemberRole
 * (packages/db/src/dal/groups.ts) apps/app's own me/group screen uses —
 * not a duplicate. It gates on requireGroupOfficer(orgId), a different
 * check than the JamiiTeamMember ADMIN/EDITOR/CONTRIBUTOR gate the rest
 * of this dashboard runs on: a page ADMIN who isn't a recognised group
 * officer (Chairperson/Treasurer/Secretary) legitimately can't change
 * who holds which office. See listMyGroupMembers, which requires the
 * caller be an active member of the group at all — the case handled
 * below.
 */
export default async function LeadershipScreen() {
  const { ctx, page } = await requireMyPage();

  let members: Awaited<ReturnType<typeof listMyGroupMembers>> = [];
  let notAMember = false;
  try {
    members = await listMyGroupMembers(ctx, page.organisationId);
  } catch (e) {
    if (e instanceof AuthorisationError) {
      notAMember = true;
    } else {
      throw e;
    }
  }

  return (
    <>
      <div className="titlebar">
        <div><h1 style={{ marginBottom: 4 }}>Team &amp; governance</h1><p className="sub" style={{ marginBottom: 0 }}>Who holds which office — shown on your public Leadership page.</p></div>
      </div>
      {notAMember ? (
        <div className="card" style={{ padding: 22, color: '#6b6552' }}>
          You can edit your website content, but changing who holds which office is only open to
          this group&rsquo;s own members — and only Chairperson, Treasurer or Secretary may make the
          change. Ask one of them, or manage membership from your Esoqo account&rsquo;s Group page.
        </div>
      ) : (
        <LeadershipRoster members={members} />
      )}
    </>
  );
}
