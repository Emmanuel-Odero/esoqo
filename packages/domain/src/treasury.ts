import { z } from 'zod';

/** ONE definition of every group-treasury input, shared by the client
 *  form and the Server Action's boundary validation. See
 *  docs/proposals/esoko-group-treasury-and-payment-id.md. */

const pinSchema = z.string().trim().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits');
const kesSchema = z.coerce.number().positive('Enter an amount above zero').max(10_000_000);

export const declareContributionSchema = z.object({
  orgId: z.string().uuid(),
  amountKes: kesSchema,
  method: z.enum(['MPESA', 'BANK_TRANSFER', 'CASH_TO_AGENT']).optional(),
  reference: z.string().trim().max(40).optional(),
  note: z.string().trim().max(280).optional(),
});
export type DeclareContributionInput = z.infer<typeof declareContributionSchema>;

export const scheduleMeetingSchema = z.object({
  orgId: z.string().uuid(),
  scheduledAt: z.coerce.date(),
  location: z.string().trim().max(120).optional(),
  agenda: z.string().trim().max(500).optional(),
  quorumPct: z.coerce.number().int().min(1).max(100).optional(),
});
export type ScheduleMeetingInput = z.infer<typeof scheduleMeetingSchema>;

export const markAttendanceSchema = z.object({
  meetingId: z.string().uuid(),
  personId: z.string().uuid().optional(),
  present: z.boolean(),
  method: z.enum(['SELF_APP', 'SELF_USSD', 'AGENT_MARKED']),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

export const requestWithdrawalSchema = z.object({
  orgId: z.string().uuid(),
  amountKes: kesSchema,
  purpose: z.string().trim().min(3, 'State what this withdrawal is for').max(200),
  payeeName: z.string().trim().min(2, 'Enter who is being paid').max(120),
  payeeMsisdn: z.string().trim().max(20).optional(),
  meetingId: z.string().uuid().optional(),
});
export type RequestWithdrawalInput = z.infer<typeof requestWithdrawalSchema>;

export const signWithdrawalSchema = z.object({
  withdrawalId: z.string().uuid(),
  decision: z.enum(['APPROVE', 'REJECT']),
  pin: pinSchema,
});
export type SignWithdrawalInput = z.infer<typeof signWithdrawalSchema>;

export const setTreasuryPolicySchema = z.object({
  orgId: z.string().uuid(),
  requiredSigners: z.coerce.number().int().min(1).max(9).optional(),
  withdrawalLeadMinutes: z.coerce.number().int().min(5).max(1440).optional(),
  activeHoursStart: z.coerce.number().int().min(0).max(23).optional(),
  activeHoursEnd: z.coerce.number().int().min(1).max(24).optional(),
  requireQuorateMeeting: z.boolean().optional(),
  contributionAmountKes: kesSchema.nullable().optional(),
  contributionCycle: z.enum(['weekly', 'monthly', 'custom']).nullable().optional(),
});
export type SetTreasuryPolicyInput = z.infer<typeof setTreasuryPolicySchema>;
