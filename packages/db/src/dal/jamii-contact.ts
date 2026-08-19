import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { requirePageAccess } from './jamii-page';
import type { JamiiContactMessageStatus } from '@prisma/client';

/**
 * Messages submitted through a page's own public Contact form
 * (apps/jamii's (site)/o/[slug]/contact page) — visible only to that
 * page's own team, in their dashboard, not a platform-wide inbox. See
 * dal/jamii-interest.ts for the sibling "wants Our Jamii access" flow
 * this is deliberately not: that's reviewed by Esoko staff platform-
 * wide; this is a visitor writing to one org, reviewed only by that
 * org's own team via requirePageAccess.
 */

/** Granted only by apps/jamii's own anonymous submit Ctx (mirroring
 *  JAMII_INTEREST_CREATE in jamii-interest.ts) — no staff role should
 *  hold this; it exists so requireCapability still runs on every write,
 *  never "this DAL function trusts its caller unconditionally." */
export const JAMII_CONTACT_CREATE = 'jamii-contact.create';

export interface SubmitJamiiContactMessageInput {
  name: string;
  email: string;
  phone?: string;
  subject?: string;
  message: string;
}

/**
 * Public submission — no page-team access required, since the caller
 * is an anonymous site visitor. Only accepts a message for a page that
 * is actually PUBLISHED, so this can't be used to probe for draft/
 * suspended pages' existence.
 */
export async function submitJamiiContactMessage(
  ctx: Ctx,
  pageId: string,
  input: SubmitJamiiContactMessageInput,
) {
  requireCapability(ctx, JAMII_CONTACT_CREATE);

  const page = await prisma.jamiiPage.findUnique({ where: { organisationId: pageId } });
  if (!page || page.status !== 'PUBLISHED') throw new Error('This page is not accepting messages right now');

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const message = input.message.trim();
  if (!name) throw new Error('A name is required');
  if (!email) throw new Error('An email address is required');
  if (!message) throw new Error('A message is required');

  const row = await prisma.jamiiContactMessage.create({
    data: {
      pageId,
      name,
      email,
      phone: input.phone?.trim() || undefined,
      subject: input.subject?.trim() || undefined,
      message,
    },
  });

  await recordAudit(ctx, {
    action: 'jamii_contact_message.created',
    targetType: 'jamii_contact_message',
    targetId: row.id,
    payload: { pageId },
  });

  return row;
}

export interface ListJamiiContactMessagesFilter {
  status?: JamiiContactMessageStatus;
}

/** The dashboard "Messages" screen — any page team member may read. */
export async function listJamiiContactMessages(
  ctx: Ctx,
  pageId: string,
  filter: ListJamiiContactMessagesFilter = {},
) {
  await requirePageAccess(ctx, pageId);
  return prisma.jamiiContactMessage.findMany({
    where: { pageId, status: filter.status },
    orderBy: { createdAt: 'desc' },
  });
}

/** Unread-count badge for the dashboard nav. */
export async function countNewJamiiContactMessages(ctx: Ctx, pageId: string): Promise<number> {
  await requirePageAccess(ctx, pageId);
  return prisma.jamiiContactMessage.count({ where: { pageId, status: 'NEW' } });
}

/** id alone is a valid WhereUniqueInput, but that would let a caller
 *  with access to page A mutate a message that actually belongs to
 *  page B by guessing its id — updateMany's where clause is arbitrary,
 *  so scoping by {id, pageId} together is what actually enforces that
 *  a message can only be touched by its own page's team. */
async function updateOwnMessage(pageId: string, messageId: string, data: { status: JamiiContactMessageStatus; readAt?: Date }) {
  const { count } = await prisma.jamiiContactMessage.updateMany({ where: { id: messageId, pageId }, data });
  if (count === 0) throw new Error('Message not found');
  return prisma.jamiiContactMessage.findUniqueOrThrow({ where: { id: messageId } });
}

export async function markJamiiContactMessageRead(ctx: Ctx, pageId: string, messageId: string) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  return updateOwnMessage(pageId, messageId, { status: 'READ', readAt: new Date() });
}

export async function archiveJamiiContactMessage(ctx: Ctx, pageId: string, messageId: string) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  return updateOwnMessage(pageId, messageId, { status: 'ARCHIVED' });
}
