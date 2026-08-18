import { z } from 'zod';
import { msisdnSchema, otpCodeSchema } from './phone';
import { COUNTIES } from './counties';

/**
 * ONE definition of a registration, used by:
 *   · the Next.js form            (client validation)
 *   · the Server Action           (boundary validation)
 *   · the API handler             (boundary validation)
 *   · the DAL                     (typed input)
 *
 * Change a field here and every consumer fails to compile until it is
 * fixed. That is the whole reason `core` is TypeScript rather than Ruby
 * or Java — nothing else on the team's stack gives this.
 */

export const joiningAsSchema = z.enum(['me', 'group', 'biz']);
export type JoiningAs = z.infer<typeof joiningAsSchema>;

export const countySchema = z.enum(COUNTIES);

/* ── step 1 ── */
export const step1Schema = z.object({
  joiningAs: joiningAsSchema,
  language: z.enum(['en', 'sw']).default('en'),
});

/* ── step 2 · names ── */
// orgName is deliberately NOT required here even when joiningAs is
// 'group' — the group's identity is resolved later (search-before-create
// via groupDetailsSchema/groupMembershipCheckSchema below), so step 2
// only needs the registrant's own name up front.
export const step2Schema = z
  .object({
    officialName: z
      .string()
      .trim()
      .min(2, 'Enter the name as written on your ID')
      .max(120),
    knownAs: z.string().trim().max(80).optional().or(z.literal('')),
    orgName: z.string().trim().max(160).optional().or(z.literal('')),
    orgKnownAs: z.string().trim().max(80).optional().or(z.literal('')),
    orgRole: z.string().trim().max(40).optional().or(z.literal('')),
    joiningAs: joiningAsSchema,
  });

/* ── step 3 · contact ── */
export const step3Schema = z.object({
  msisdn: msisdnSchema,
  email: z.string().trim().email('That does not look like an email address')
    .optional().or(z.literal('')),
  county: countySchema,
  ward: z.string().trim().max(80).optional().or(z.literal('')),
});

/* ── step 4 · work ── */
export const step4Schema = z.object({
  workRaw: z.string().trim().min(2, 'Tell us what you do').max(120),
  segment: z.string().trim().max(60).optional().or(z.literal('')),
});

/* ── step 5 · standing ── */
const yesNoSoon = z.enum(['yes', 'no', 'soon']);

export const step5Schema = z.object({
  joiningAs: joiningAsSchema,
  hasRegisteredBusiness: yesNoSoon.optional(),
  registrationNo: z.string().trim().max(40).optional().or(z.literal('')),
  belongsToGroup: z.enum(['yes', 'no']).optional(),
  groupName: z.string().trim().max(160).optional().or(z.literal('')),
  groupPartyId: z.string().uuid().optional(),
  feeCoverage: z.enum(['group', 'self']).optional(),
  memberCount: z.coerce.number().int().min(1).max(10_000).optional(),
  hasKraPin: z.enum(['yes', 'no']).optional(),
});

/* ── group search-before-create ── */

/** Every OrgKind, kept in sync by hand with the Prisma enum and with
 *  @esoko/db's GROUP_KINDS label map — domain intentionally has no
 *  dependency on db, so this is the one place outside the schema/DAL
 *  itself that needs to change if a kind is ever added or renamed. */
export const ORG_KINDS = [
  'CHAMA', 'SELF_HELP_GROUP', 'TABLE_BANKING', 'WELFARE_GROUP', 'CBO', 'FBO',
  'COOPERATIVE', 'SACCO', 'NGO', 'BUSINESS', 'SCHOOL', 'CLINIC',
  'MARKET_ASSOCIATION', 'OTHER',
] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

/** The "a group" path on /join never offers BUSINESS — that's its own
 *  dedicated search-before-create flow (see bizStandingSchema below). */
export const JOINABLE_GROUP_KINDS = ORG_KINDS.filter((k) => k !== 'BUSINESS');
export const joinableGroupKindSchema = z.enum(
  JOINABLE_GROUP_KINDS as [string, ...string[]],
);

/** Only asked once search-before-create came up empty and the joiner
 *  chose to register a brand-new group. No separate county field — the
 *  group is founded in the same county already given in step 3
 *  (contact), same as completeRegistration has always done. */
export const groupDetailsSchema = z.object({
  orgName: z.string().trim().min(2, 'Enter the official name of the group').max(160),
  orgKnownAs: z.string().trim().max(80).optional().or(z.literal('')),
  orgKind: joinableGroupKindSchema,
  orgSubCounty: z.string().trim().max(80).optional().or(z.literal('')),
  orgDistrict: z.string().trim().max(80).optional().or(z.literal('')),
  /** What most members deal in — segment keys from the shared work
   *  dictionary, so group and personal "what do you do" tags line up. */
  orgTags: z.array(z.string().trim().min(1)).max(6).default([]),
  registrationNo: z.string().trim().max(40).optional().or(z.literal('')),
  memberCount: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type GroupDetails = z.infer<typeof groupDetailsSchema>;

/** The private "am I already listed?" check — a name or a phone, never
 *  both required, since a pending member added by staff may have only
 *  a name on file yet. */
export const groupMembershipCheckSchema = z
  .object({
    groupPartyId: z.string().uuid(),
    name: z.string().trim().max(120).optional().or(z.literal('')),
    msisdn: msisdnSchema.optional().or(z.literal('')),
  })
  .refine((v) => Boolean(v.name) || Boolean(v.msisdn), {
    message: 'Enter your name or phone number to check',
  });

/* ── business sub-flow ── */

export const businessTypeKeySchema = z.enum([
  'SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'LIMITED_COMPANY', 'COOPERATIVE',
  'SELF_HELP_ENTERPRISE', 'OTHER',
]);
export type BusinessTypeKey = z.infer<typeof businessTypeKeySchema>;

/** "Is it registered?" branch — asked before anything else, so an
 *  already-registered business can be looked up by its number first. */
export const bizStandingSchema = z
  .object({
    bizIsRegistered: z.enum(['yes', 'no']),
    registrationNo: z.string().trim().max(40).optional().or(z.literal('')),
    bizIntendsToRegister: z.enum(['yes', 'no']).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.bizIsRegistered === 'yes' && !v.registrationNo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ['registrationNo'],
        message: 'Enter the registration number as on the certificate',
      });
    }
    if (v.bizIsRegistered === 'no' && !v.bizIntendsToRegister) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ['bizIntendsToRegister'],
        message: 'Let us know if you plan to register it',
      });
    }
  });
export type BizStanding = z.infer<typeof bizStandingSchema>;

/** Only asked once the live search (by name or registration number) came
 *  up empty and the joiner chose to register a new business. */
export const bizDetailsSchema = z
  .object({
    bizName: z.string().trim().min(2, 'Enter the business name').max(160),
    bizSector: z.string().trim().max(60).optional().or(z.literal('')),
    bizType: businessTypeKeySchema,
    bizTypeOther: z.string().trim().max(80).optional().or(z.literal('')),
  })
  .superRefine((v, ctx) => {
    if (v.bizType === 'OTHER' && !v.bizTypeOther) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ['bizTypeOther'],
        message: 'Tell us what kind of business this is',
      });
    }
  });
export type BizDetails = z.infer<typeof bizDetailsSchema>;

/** Financials — everything optional, matching the rest of the flow's
 *  "ask, never force" posture around money. */
export const bizFinancialsSchema = z.object({
  bizEmployeeCount: z.coerce.number().int().min(0).max(100_000).optional(),
  bizRevenueGoodKes: z.coerce.number().min(0).max(1_000_000_000).optional(),
  bizRevenueBadKes: z.coerce.number().min(0).max(1_000_000_000).optional(),
  bizBankProvider: z.string().trim().max(80).optional().or(z.literal('')),
  bizPaymentChannels: z.array(z.string().trim().min(1)).max(8).default([]),
});
export type BizFinancials = z.infer<typeof bizFinancialsSchema>;

/** Business already found via live search — nothing left to fill in but
 *  the searcher's own place in the registration. */
export const bizSearchMatchSchema = z.object({
  bizPartyId: z.string().uuid(),
});

/* ── step 6 · verification and preferences ── */
export const step6Schema = z.object({
  ussdSetupChoice: z.enum(['now', 'later'], {
    required_error: 'Choose whether to set up dialling access now or later',
  }),
  wantsPriceSms: z.boolean().default(false),
  wantsReceiptSms: z.boolean().default(true),
  wantsExpirySms: z.boolean().default(true),
});

/* ── OTP ── */
export const requestOtpSchema = z.object({
  registrationId: z.string().uuid(),
  msisdn: msisdnSchema,
});

export const verifyOtpSchema = z.object({
  registrationId: z.string().uuid(),
  code: otpCodeSchema,
});

/* ── the whole thing, for the final submit ── */
export const completeRegistrationSchema = z.object({
  registrationId: z.string().uuid(),
  ussdSetupChoice: z.enum(['now', 'later']),
  wantsPriceSms: z.boolean(),
  wantsReceiptSms: z.boolean(),
  wantsExpirySms: z.boolean(),
  /** Explicit, recorded, and the exact wording shown is stored with it. */
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You need to accept the terms to join' }),
  }),
});

export type Step1 = z.infer<typeof step1Schema>;
export type Step2 = z.infer<typeof step2Schema>;
export type Step3 = z.infer<typeof step3Schema>;
export type Step4 = z.infer<typeof step4Schema>;
export type Step5 = z.infer<typeof step5Schema>;
export type Step6 = z.infer<typeof step6Schema>;
export type CompleteRegistration = z.infer<typeof completeRegistrationSchema>;

/** Institutions never self-register. Different route entirely. */
export const institutionEnquirySchema = z.object({
  organisation: z.string().trim().min(2).max(160),
  contactName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  interest: z.enum([
    'lending', 'insurance', 'buying', 'county', 'issuing', 'programme',
  ]),
  note: z.string().trim().max(2000).optional().or(z.literal('')),
});
export type InstitutionEnquiry = z.infer<typeof institutionEnquirySchema>;
