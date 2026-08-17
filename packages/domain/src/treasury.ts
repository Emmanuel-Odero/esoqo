import { z } from 'zod';
import { JOINABLE_GROUP_KINDS } from './registration';
import { msisdnSchema } from './phone';

/** ONE definition of every group-treasury input, shared by the client
 *  form and the Server Action's boundary validation. See
 *  docs/proposals/esoko-group-treasury-and-payment-id.md. */

const pinSchema = z.string().trim().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits');
const kesSchema = z.coerce.number().positive('Enter an amount above zero').max(10_000_000);

/** Self-serve group founding — /me/group's "start a group" form. Same
 *  ORG_KINDS the join funnel and admin's Groups screen use (see
 *  JOINABLE_GROUP_KINDS), so a self-founded group is indistinguishable
 *  from one staff registered off a paper roster. */
export const createOwnGroupSchema = z.object({
  orgKind: z.enum(JOINABLE_GROUP_KINDS as [string, ...string[]]).default('CHAMA'),
  /** Required, and only meaningful, when orgKind is OTHER — see the
   *  refine below. Same shape as Organisation.businessType/
   *  businessTypeOther for the BUSINESS path. */
  orgKindOther: z.string().trim().max(80).optional().or(z.literal('')),
  officialName: z.string().trim().min(2, 'Give your group a name').max(160),
  knownAs: z.string().trim().max(80).optional().or(z.literal('')),
  county: z.string().trim().min(2, 'Choose a county'),
  ward: z.string().trim().max(80).optional().or(z.literal('')),
  registrationNo: z.string().trim().max(60).optional().or(z.literal('')),
  memberCount: z.coerce.number().int().min(1).max(10_000).optional(),
}).refine((v) => v.orgKind !== 'OTHER' || Boolean(v.orgKindOther?.trim()), {
  message: 'Say what kind of group this is',
  path: ['orgKindOther'],
});
export type CreateOwnGroupInput = z.infer<typeof createOwnGroupSchema>;

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
  contributionsEnabled: z.boolean().optional(),
  contributionAmountKes: kesSchema.nullable().optional(),
  contributionCycle: z.enum(['weekly', 'monthly', 'custom']).nullable().optional(),
  /** Null/0 = free to join. See joinFeeKes on GroupTreasuryPolicy. */
  joinFeeKes: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
});
export type SetTreasuryPolicyInput = z.infer<typeof setTreasuryPolicySchema>;

/** /me/group's "invite a member" form — an officer inviting someone by
 *  phone or email (at least one required — see the refine below).
 *  officialName is only required when that contact isn't already on
 *  Esoko — see inviteMember in dal/groups.ts. */
export const inviteMemberSchema = z.object({
  orgId: z.string().uuid(),
  msisdn: msisdnSchema.optional().or(z.literal('')),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').optional().or(z.literal('')),
  officialName: z.string().trim().max(120).optional(),
  role: z.enum(['CHAIRPERSON', 'TREASURER', 'SECRETARY', 'MEMBER', 'OTHER']).default('MEMBER'),
  customRole: z.string().trim().max(60).optional(),
}).refine((v) => Boolean(v.msisdn) || Boolean(v.email), {
  message: 'Enter a phone number or an email address',
  path: ['msisdn'],
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const setMemberRoleSchema = z.object({
  membershipId: z.string().uuid(),
  role: z.enum(['CHAIRPERSON', 'TREASURER', 'SECRETARY', 'MEMBER', 'OTHER']),
  customRole: z.string().trim().max(60).optional(),
});
export type SetMemberRoleInput = z.infer<typeof setMemberRoleSchema>;

export const removeMemberSchema = z.object({
  membershipId: z.string().uuid(),
  reason: z.string().trim().min(2, 'Say why they are being removed').max(200),
});
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;

export const createJoinFeePaymentSchema = z.object({
  orgId: z.string().uuid(),
  method: z.enum(['MPESA', 'BANK_TRANSFER', 'CASH_TO_AGENT']).optional(),
  reference: z.string().trim().max(40).optional(),
});
export type CreateJoinFeePaymentInput = z.infer<typeof createJoinFeePaymentSchema>;
