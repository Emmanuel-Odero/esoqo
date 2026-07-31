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

export const joiningAsSchema = z.enum(['me', 'group', 'biz', 'inst']);
export type JoiningAs = z.infer<typeof joiningAsSchema>;

export const countySchema = z.enum(COUNTIES);

/* ── step 1 ── */
export const step1Schema = z.object({
  joiningAs: joiningAsSchema,
  language: z.enum(['en', 'sw']).default('en'),
});

/* ── step 2 · names ── */
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
  })
  .superRefine((v, ctx) => {
    if (v.joiningAs === 'group' && !v.orgName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['orgName'],
        message: 'Enter the official name of the group',
      });
    }
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
