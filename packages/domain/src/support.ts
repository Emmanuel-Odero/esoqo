import { z } from 'zod';

/**
 * "Report an issue" — see SupportTicket's doc comment in
 * schema.prisma. Platform-wide (any signed-in person, any app), not
 * jamii-specific, even though the Our Jamii dashboard is the only UI
 * that raises one today.
 */
export const SUPPORT_TICKET_CATEGORIES = ['BUG', 'QUESTION', 'BILLING', 'ACCOUNT', 'OTHER'] as const;
export const SUPPORT_TICKET_CATEGORY_LABELS: Record<(typeof SUPPORT_TICKET_CATEGORIES)[number], string> = {
  BUG: 'Something is broken', QUESTION: 'I have a question', BILLING: 'Payments or donations',
  ACCOUNT: 'My account or sign-in', OTHER: 'Something else',
};

export const createSupportTicketSchema = z.object({
  category: z.enum(SUPPORT_TICKET_CATEGORIES).default('OTHER'),
  // Free text when category is OTHER — every "Other" choice in this
  // app gets a paired free-text field, not a dead end.
  categoryOther: z.string().trim().max(80).optional().or(z.literal('')),
  subject: z.string().trim().min(3, 'Give your ticket a short subject').max(140),
  message: z.string().trim().min(10, 'Say a bit more about what happened').max(4000),
}).refine(
  (v) => v.category !== 'OTHER' || Boolean(v.categoryOther?.trim()),
  { message: 'Say what this is about', path: ['categoryOther'] },
);
export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;

export const SUPPORT_TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export const SUPPORT_TICKET_STATUS_LABELS: Record<(typeof SUPPORT_TICKET_STATUSES)[number], string> = {
  OPEN: 'Open', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', CLOSED: 'Closed',
};

export const updateSupportTicketStatusSchema = z.object({
  ticketId: z.string().uuid(),
  status: z.enum(SUPPORT_TICKET_STATUSES),
  staffNote: z.string().trim().max(2000).optional().or(z.literal('')),
});
export type UpdateSupportTicketStatusInput = z.infer<typeof updateSupportTicketStatusSchema>;
