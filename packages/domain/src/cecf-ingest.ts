import { z } from 'zod';
import { msisdnSchema } from './phone';
import { countySchema, joinableGroupKindSchema, businessTypeKeySchema } from './registration';

/**
 * The WordPress → esoko payload contract for CECF registrations.
 *
 * This is the one shape both services/core's /api/cecf/* facade and the
 * CECF WordPress site's PHP client agree on — see
 * docs/proposals/cecf-wordpress-registration.md for the full sequence.
 * Field names deliberately track the existing step2Schema/step5Schema/
 * groupDetailsSchema/bizDetailsSchema shapes in registration.ts rather
 * than inventing new ones, since everything here lands in the same
 * Registration row those schemas already describe.
 */

const memberRoleSchema = z.enum(['CHAIRPERSON', 'TREASURER', 'SECRETARY', 'MEMBER', 'OTHER']);

export const cecfMemberSchema = z.object({
  officialName: z.string().trim().min(2, 'Enter the member’s name').max(120),
  msisdn: msisdnSchema.optional(),
  role: memberRoleSchema.default('MEMBER'),
  customRole: z.string().trim().max(40).optional(),
});
export type CecfMember = z.infer<typeof cecfMemberSchema>;

export const cecfDocumentKindSchema = z.enum([
  'NATIONAL_ID', 'GROUP_CONSTITUTION', 'MEMBER_LIST', 'MINUTES', 'REGISTRATION_CERT',
  'KRA_PIN', 'PERMIT', 'PAYMENT_RECEIPT', 'PHOTO', 'OTHER',
]);

/** File bytes travel as base64 — WP's PHP already has them in hand by the
 *  time it calls this endpoint, and there is no browser-to-esoko hop to
 *  keep multipart for. */
export const cecfDocumentUploadSchema = z.object({
  kind: cecfDocumentKindSchema,
  title: z.string().trim().min(1).max(160),
  originalName: z.string().trim().min(1).max(200),
  mimeType: z.string().min(1),
  base64: z.string().min(1),
});
export type CecfDocumentUpload = z.infer<typeof cecfDocumentUploadSchema>;

export const cecfPaymentMethodSchema = z.enum(['MPESA', 'CARD', 'BANK_TRANSFER', 'CASH_TO_AGENT']);

/** Absent method = "pay later" — a legitimate, non-blocking choice, same
 *  rule as deferPayment. */
export const cecfPaymentSchema = z.object({
  method: cecfPaymentMethodSchema.optional(),
  reference: z.string().trim().max(80).optional(),
  amountKes: z.coerce.number().min(0).optional(),
  /** Set once /api/cecf/payments/mpesa/initiate has already run and
   *  (in console mode, or after the real callback lands) confirmed. */
  checkoutRequestId: z.string().optional(),
  pesapalOrderTrackingId: z.string().optional(),
});
export type CecfPayment = z.infer<typeof cecfPaymentSchema>;

export const cecfRegistrantSchema = z.object({
  officialName: z.string().trim().min(2, 'Enter the name as written on your ID').max(120),
  knownAs: z.string().trim().max(80).optional(),
  msisdn: msisdnSchema,
  /** True only when WordPress's own OTP step (or equivalent) actually
   *  verified this number — never trusted from the client alone; the
   *  ingest route re-derives this from whether the registration was
   *  actually completed via a verified msisdn on the WP side, same
   *  caution completeRegistration already applies. */
  msisdnVerified: z.boolean().default(false),
  email: z.string().trim().email().optional().or(z.literal('')),
  county: countySchema,
  ward: z.string().trim().max(80).optional(),
  workRaw: z.string().trim().max(120).optional(),
  hasKraPin: z.enum(['yes', 'no']).optional(),
});
export type CecfRegistrant = z.infer<typeof cecfRegistrantSchema>;

export const cecfGroupIngestSchema = z.object({
  joiningAs: z.literal('group'),
  registrant: cecfRegistrantSchema,
  /** The registering person's own role in the group — determines whether
   *  a per-member join fee can be configured at all (only an officer may
   *  set GroupTreasuryPolicy; see trySetCecfJoinFee). */
  registrantRole: memberRoleSchema.default('CHAIRPERSON'),
  orgName: z.string().trim().min(2, 'Enter the official name of the group').max(160),
  orgKnownAs: z.string().trim().max(80).optional(),
  orgKind: joinableGroupKindSchema,
  orgSubCounty: z.string().trim().max(80).optional(),
  orgDistrict: z.string().trim().max(80).optional(),
  orgTags: z.array(z.string().trim().min(1)).max(6).default([]),
  isRegistered: z.enum(['yes', 'no', 'started']),
  registrationNo: z.string().trim().max(40).optional(),
  memberCount: z.coerce.number().int().min(1).max(10_000),
  /** The roster beyond the registering founder — added as PENDING/ACTIVE
   *  memberships once the group itself exists. */
  members: z.array(cecfMemberSchema).max(500).default([]),
  /** 'group' = one lump-sum registration fee for the whole team.
   *  'self' = each member (this founder included) covers their own
   *  KES 500 — sets GroupTreasuryPolicy.joinFeeKes so future members
   *  default to PENDING until they pay it themselves. */
  feeCoverage: z.enum(['group', 'self']),
  payment: cecfPaymentSchema.optional(),
  documents: z.array(cecfDocumentUploadSchema).max(6).default([]),
});
export type CecfGroupIngest = z.infer<typeof cecfGroupIngestSchema>;

export const cecfBusinessIngestSchema = z.object({
  joiningAs: z.literal('biz'),
  registrant: cecfRegistrantSchema,
  bizName: z.string().trim().min(2, 'Enter the business name').max(160),
  bizSector: z.string().trim().max(60).optional(),
  bizType: businessTypeKeySchema,
  bizTypeOther: z.string().trim().max(80).optional(),
  bizIsRegistered: z.enum(['yes', 'no']),
  registrationNo: z.string().trim().max(40).optional(),
  bizIntendsToRegister: z.enum(['yes', 'no']).optional(),
  bizEmployeeCount: z.coerce.number().int().min(0).max(100_000).optional(),
  bizRevenueGoodKes: z.coerce.number().min(0).max(1_000_000_000).optional(),
  bizRevenueBadKes: z.coerce.number().min(0).max(1_000_000_000).optional(),
  bizBankProvider: z.string().trim().max(80).optional(),
  payment: cecfPaymentSchema.optional(),
  documents: z.array(cecfDocumentUploadSchema).max(6).default([]),
});
export type CecfBusinessIngest = z.infer<typeof cecfBusinessIngestSchema>;

export const cecfIndividualIngestSchema = z.object({
  joiningAs: z.literal('me'),
  registrant: cecfRegistrantSchema,
  payment: cecfPaymentSchema.optional(),
  documents: z.array(cecfDocumentUploadSchema).max(6).default([]),
});
export type CecfIndividualIngest = z.infer<typeof cecfIndividualIngestSchema>;

export const cecfIngestSchema = z.discriminatedUnion('joiningAs', [
  cecfIndividualIngestSchema, cecfGroupIngestSchema, cecfBusinessIngestSchema,
]);
export type CecfIngestInput = z.infer<typeof cecfIngestSchema>;
