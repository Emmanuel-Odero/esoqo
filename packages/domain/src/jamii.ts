import { z } from 'zod';
import { ORG_KINDS } from './registration';

/**
 * Our Jamii — CECF community mini-sites + crowdfunding.
 *
 * Same "one schema, shared by client validation and the Server Action
 * boundary" rule as store.ts. Reuses ORG_KINDS from registration.ts —
 * the same group-kind list the join funnel and admin's Groups screen
 * already use, rather than a second, slightly different one. BUSINESS
 * is excluded here the same way JOINABLE_GROUP_KINDS excludes it — Our
 * Jamii is for community groups, not registered businesses.
 */
export const JAMII_ORG_KINDS = ORG_KINDS.filter((k) => k !== 'BUSINESS' && k !== 'SCHOOL' && k !== 'CLINIC');

export const JAMII_ORG_KIND_LABELS: Record<string, string> = {
  CHAMA: 'Chama', SELF_HELP_GROUP: 'Self-help group', TABLE_BANKING: 'Table-banking group',
  WELFARE_GROUP: 'Welfare group', CBO: 'Community-based organisation', FBO: 'Faith-based organisation',
  COOPERATIVE: 'Co-operative', SACCO: 'SACCO', NGO: 'NGO', MARKET_ASSOCIATION: 'Market association',
  OTHER: 'Other',
};

export const JAMII_CAUSES = [
  ['water', 'Water'],
  ['youth', 'Youth'],
  ['enterprise', 'Enterprise'],
  ['agriculture', 'Agriculture'],
  ['education', 'Education'],
  ['health', 'Health'],
] as const;

/** Step 2 of /start — founds the group and its page. */
export const startJamiiPageSchema = z.object({
  orgKind: z.enum(JAMII_ORG_KINDS as [string, ...string[]]).default('CBO'),
  officialName: z.string().trim().min(2, 'Give your organisation a name').max(120),
  county: z.string().trim().min(2, 'Choose a county'),
  ward: z.string().trim().max(80).optional().or(z.literal('')),
  registrationNo: z.string().trim().max(60).optional().or(z.literal('')),
  memberCount: z.number().int().positive().max(100_000).optional(),
  tagline: z.string().trim().max(120).optional().or(z.literal('')),
});
export type StartJamiiPageInput = z.infer<typeof startJamiiPageSchema>;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Settings → page profile. One combined save — the dashboard's About/
 *  Contact/Socials fields are few enough not to warrant store.ts's
 *  multi-step split. */
export const jamiiPageProfileSchema = z.object({
  tagline: z.string().trim().max(120).optional().or(z.literal('')),
  missionShort: z.string().trim().max(160).optional().or(z.literal('')),
  aboutUs: z.string().trim().max(4000).optional().or(z.literal('')),
  meetingSchedule: z.string().trim().max(160).optional().or(z.literal('')),
  contactEmail: z.string().trim().toLowerCase().email('Enter a valid email address').max(160).optional().or(z.literal('')),
  contactPhone: z.string().trim().regex(/^\+254(7|1)\d{8}$/, 'Enter a valid Kenyan mobile number').optional().or(z.literal('')),
  website: z.string().trim().max(160).optional().or(z.literal('')),
  facebook: z.string().trim().max(80).optional().or(z.literal('')),
  instagram: z.string().trim().max(80).optional().or(z.literal('')),
  twitter: z.string().trim().max(80).optional().or(z.literal('')),
  whatsapp: z.string().trim().max(80).optional().or(z.literal('')),
  brandAccent: z.string().trim().regex(HEX, 'Colour must be a hex value like #B93A24').optional().or(z.literal('')),
});
export type JamiiPageProfileInput = z.infer<typeof jamiiPageProfileSchema>;

export const jamiiFaqItemSchema = z.object({
  q: z.string().trim().min(2, 'Enter a question').max(200),
  a: z.string().trim().min(2, 'Enter an answer').max(1000),
});
export const jamiiFaqSchema = z.array(jamiiFaqItemSchema).max(20);

export const jamiiPostSchema = z.object({
  title: z.string().trim().min(2, 'Give the update a title').max(140),
  excerpt: z.string().trim().max(220).optional().or(z.literal('')),
  body: z.string().trim().min(2, 'Write what happened').max(6000),
  imageUrl: z.string().trim().max(2000).optional().or(z.literal('')),
});
export type JamiiPostInput = z.infer<typeof jamiiPostSchema>;

export const jamiiProgramSchema = z.object({
  title: z.string().trim().min(2, 'Name the programme').max(120),
  body: z.string().trim().min(2, 'Describe the programme').max(1000),
  icon: z.string().trim().max(8).optional().or(z.literal('')),
});
export type JamiiProgramInput = z.infer<typeof jamiiProgramSchema>;

export const createCampaignSchema = z.object({
  title: z.string().trim().min(2, 'Give the campaign a title').max(140),
  summary: z.string().trim().min(2, 'Summarise what this raises for').max(280),
  body: z.string().trim().max(6000).optional().or(z.literal('')),
  goalKes: z.number().positive('Set a goal above zero').max(100_000_000),
  coverUrl: z.string().trim().max(2000).optional().or(z.literal('')),
  endsAt: z.string().optional().or(z.literal('')),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const campaignUpdateSchema = z.object({
  title: z.string().trim().min(2, 'Give the update a title').max(140),
  body: z.string().trim().min(2, 'Write the update').max(4000),
});

export const inviteTeamMemberSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  role: z.enum(['ADMIN', 'EDITOR', 'CONTRIBUTOR']).default('EDITOR'),
});
export type InviteTeamMemberInput = z.infer<typeof inviteTeamMemberSchema>;

/** The public donate form — "Anonymous" just skips donorName. */
export const donateSchema = z.object({
  campaignId: z.string().uuid(),
  donorName: z.string().trim().max(120).optional().or(z.literal('')),
  donorMsisdn: z
    .string()
    .trim()
    .regex(/^\+254(7|1)\d{8}$/, 'Enter a valid Kenyan mobile number'),
  amountKes: z.number().positive('Enter an amount above zero').max(10_000_000),
  anonymous: z.boolean().default(false),
});
export type DonateInput = z.infer<typeof donateSchema>;

export const jamiiContactSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  topic: z.string().trim().max(80).optional().or(z.literal('')),
  message: z.string().trim().min(5, 'Say a little about how we can help').max(2000),
});
export type JamiiContactInput = z.infer<typeof jamiiContactSchema>;

/**
 * Someone tried to sign in or set a PIN on Our Jamii with a phone/email
 * that isn't an existing CECF member — access is gated to members, so
 * this is the "leave your details, we'll follow up" fallback rather
 * than a dead end. See @esoko/db's createJamiiInterest and the admin
 * app's /jamii-interest screen.
 */
export const jamiiInterestSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name').max(120),
  msisdn: z.string().trim().regex(/^\+254(7|1)\d{8}$/, 'Enter a valid Kenyan mobile number'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').optional().or(z.literal('')),
  county: z.string().trim().max(80).optional().or(z.literal('')),
  organisationName: z.string().trim().max(160).optional().or(z.literal('')),
  message: z.string().trim().max(1000).optional().or(z.literal('')),
});
export type JamiiInterestInput = z.infer<typeof jamiiInterestSchema>;
