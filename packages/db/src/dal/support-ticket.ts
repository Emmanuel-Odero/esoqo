import { prisma } from '../client';
import { recordAudit } from '../audit';
import { requireCapability, type Ctx } from '../capabilities';
import type { SupportTicketCategory, SupportTicketStatus } from '@prisma/client';

/**
 * "Report an issue" — see SupportTicket's own doc comment in
 * schema.prisma. Self-serve (any signed-in Party), reviewed by Esoqo
 * staff holding `support-ticket.manage`.
 */

export interface CreateSupportTicketInput {
  category: SupportTicketCategory;
  categoryOther?: string;
  subject: string;
  message: string;
  pageId?: string;
}

export async function createSupportTicket(ctx: Ctx, input: CreateSupportTicketInput) {
  if (!ctx.partyId) throw new Error('Sign in to raise a ticket');
  const subject = input.subject.trim();
  const message = input.message.trim();
  if (!subject) throw new Error('Give your ticket a subject');
  if (!message) throw new Error('Describe what happened');

  const ticket = await prisma.supportTicket.create({
    data: {
      reporterPartyId: ctx.partyId,
      pageId: input.pageId ?? null,
      category: input.category,
      categoryOther: input.category === 'OTHER' ? input.categoryOther?.trim() || null : null,
      subject,
      message,
    },
  });

  await recordAudit(ctx, {
    action: 'support_ticket.created', targetType: 'support_ticket', targetId: ticket.id,
    payload: { category: input.category },
  });
  return ticket;
}

/** The reporter's own list — "my tickets", newest first. */
export async function listMySupportTickets(ctx: Ctx) {
  if (!ctx.partyId) return [];
  return prisma.supportTicket.findMany({
    where: { reporterPartyId: ctx.partyId },
    orderBy: { createdAt: 'desc' },
  });
}

export interface ListSupportTicketsForStaffFilter {
  status?: SupportTicketStatus;
  take?: number;
  skip?: number;
}

/** Staff's own queue — every ticket, any reporter. */
export async function listSupportTicketsForStaff(ctx: Ctx, f: ListSupportTicketsForStaffFilter = {}) {
  requireCapability(ctx, 'support-ticket.read');
  const where = { status: f.status };
  const [rows, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      include: {
        reporter: {
          include: {
            person: { select: { officialName: true, knownAs: true, email: true, msisdn: true } },
          },
        },
        page: { select: { slug: true, organisation: { select: { officialName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: f.take ?? 50,
      skip: f.skip ?? 0,
    }),
    prisma.supportTicket.count({ where }),
  ]);
  return { rows, total };
}

export async function getSupportTicketCountsForStaff(ctx: Ctx) {
  requireCapability(ctx, 'support-ticket.read');
  const [open, inProgress, resolved, closed] = await Promise.all([
    prisma.supportTicket.count({ where: { status: 'OPEN' } }),
    prisma.supportTicket.count({ where: { status: 'IN_PROGRESS' } }),
    prisma.supportTicket.count({ where: { status: 'RESOLVED' } }),
    prisma.supportTicket.count({ where: { status: 'CLOSED' } }),
  ]);
  return { open, inProgress, resolved, closed, total: open + inProgress + resolved + closed };
}

export async function updateSupportTicketStatus(
  ctx: Ctx, ticketId: string, status: SupportTicketStatus, staffNote?: string,
) {
  requireCapability(ctx, 'support-ticket.write');
  const ticket = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: {
      status,
      staffNote: staffNote?.trim() || undefined,
      resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? new Date() : null,
    },
  });
  await recordAudit(ctx, {
    action: 'support_ticket.status_changed', targetType: 'support_ticket', targetId: ticketId,
    payload: { status },
  });
  return ticket;
}
