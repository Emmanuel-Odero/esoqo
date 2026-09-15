import { prisma } from '../client';
import { recordAudit } from '../audit';
import type { Ctx } from '../capabilities';
import type { JamiiTeamRole } from '@prisma/client';
import { requirePageAccess } from './jamii-page';

export interface InviteTeamMemberInput {
  name: string;
  email: string;
  role: JamiiTeamRole;
}

/**
 * Invites someone to manage a page. If their email already belongs to a
 * registered Person, the row links immediately (`acceptedAt` set) — no
 * separate invite-acceptance flow needed for someone already on Esoqo.
 * Otherwise it sits pending (personId null) until they register with
 * that email and the invite is claimed — see acceptPendingInvites.
 */
export async function inviteTeamMember(ctx: Ctx, pageId: string, input: InviteTeamMemberInput) {
  await requirePageAccess(ctx, pageId, 'ADMIN');
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) throw new Error('A name is required');
  if (!email) throw new Error('An email is required');

  const existingPerson = await prisma.person.findFirst({ where: { email } });

  const member = await prisma.jamiiTeamMember.upsert({
    where: { pageId_inviteEmail: { pageId, inviteEmail: email } },
    create: {
      pageId, inviteName: name, inviteEmail: email, role: input.role,
      personId: existingPerson?.partyId ?? null,
      acceptedAt: existingPerson ? new Date() : null,
    },
    update: { removedAt: null, role: input.role, inviteName: name },
  });

  await recordAudit(ctx, {
    action: 'jamii_team.invited', targetType: 'jamii_team_member', targetId: member.id,
    payload: { pageId, email, role: input.role },
  });
  return member;
}

export async function removeTeamMember(ctx: Ctx, pageId: string, memberId: string) {
  await requirePageAccess(ctx, pageId, 'ADMIN');
  const member = await prisma.jamiiTeamMember.update({
    where: { id: memberId },
    data: { removedAt: new Date() },
  });
  await recordAudit(ctx, { action: 'jamii_team.removed', targetType: 'jamii_team_member', targetId: memberId });
  return member;
}

export async function listTeamMembers(ctx: Ctx, pageId: string) {
  await requirePageAccess(ctx, pageId);
  return prisma.jamiiTeamMember.findMany({
    where: { pageId, removedAt: null },
    orderBy: { invitedAt: 'asc' },
  });
}

/** Called right after sign-in — claims any pending invites addressed to this person's email. */
export async function acceptPendingInvites(personId: string) {
  const person = await prisma.person.findUnique({ where: { partyId: personId } });
  if (!person?.email) return;
  await prisma.jamiiTeamMember.updateMany({
    where: { inviteEmail: person.email.toLowerCase(), personId: null, removedAt: null },
    data: { personId, acceptedAt: new Date() },
  });
}
