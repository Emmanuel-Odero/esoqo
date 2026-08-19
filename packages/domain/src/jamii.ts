import { z } from 'zod';
import { ORG_KINDS } from './registration';
import { richTextField } from './rich-text';

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
  visionShort: z.string().trim().max(160).optional().or(z.literal('')),
  // Rich text (Tiptap) — sanitized here, before it ever reaches the DAL.
  // See rich-text.ts's header comment for the full write/read-time story.
  aboutUs: richTextField(4000),
  meetingSchedule: z.string().trim().max(160).optional().or(z.literal('')),
  contactEmail: z.string().trim().toLowerCase().email('Enter a valid email address').max(160).optional().or(z.literal('')),
  contactPhone: z.string().trim().regex(/^\+254(7|1)\d{8}$/, 'Enter a valid Kenyan mobile number').optional().or(z.literal('')),
  website: z.string().trim().max(160).optional().or(z.literal('')),
  facebook: z.string().trim().max(80).optional().or(z.literal('')),
  instagram: z.string().trim().max(80).optional().or(z.literal('')),
  twitter: z.string().trim().max(80).optional().or(z.literal('')),
  whatsapp: z.string().trim().max(80).optional().or(z.literal('')),
  brandAccent: z.string().trim().regex(HEX, 'Colour must be a hex value like #D81E56').optional().or(z.literal('')),
  brandAccentTwo: z.string().trim().regex(HEX, 'Colour must be a hex value like #0E7F9C').optional().or(z.literal('')),
  brandAccentThree: z.string().trim().regex(HEX, 'Colour must be a hex value like #B8720F').optional().or(z.literal('')),
  themeDefaultMode: z.enum(['DARK', 'LIGHT']).optional(),
});
export type JamiiPageProfileInput = z.infer<typeof jamiiPageProfileSchema>;

export const jamiiFaqItemSchema = z.object({
  q: z.string().trim().min(2, 'Enter a question').max(200),
  a: richTextField(1000, { length: 2, message: 'Enter an answer' }),
});
export const jamiiFaqSchema = z.array(jamiiFaqItemSchema).max(20);

export const jamiiPostSchema = z.object({
  title: z.string().trim().min(2, 'Give the update a title').max(140),
  excerpt: z.string().trim().max(220).optional().or(z.literal('')),
  body: richTextField(6000, { length: 2, message: 'Write what happened' }),
  imageUrl: z.string().trim().max(2000).optional().or(z.literal('')),
});
export type JamiiPostInput = z.infer<typeof jamiiPostSchema>;

/**
 * A programme's `icon` is an @esoko/ui IconName, never free text — see
 * that package's Icon.tsx header: "No emoji anywhere in this product."
 * Duplicated here as a plain string list (not imported from @esoko/ui,
 * which is a React component package with no business being a
 * dependency of pure validation) rather than the full IconName union;
 * this is the deliberately-curated subset that reads sensibly next to
 * a community programme, not every icon in the 63-glyph set.
 */
export const JAMII_PROGRAM_ICONS = [
  'scales', 'key', 'chart', 'certificate', 'users', 'handshake', 'shield',
  'umbrella', 'leaf', 'wheat', 'building', 'gov', 'bank', 'phone-call',
  'message', 'star',
] as const;

export const jamiiProgramSchema = z.object({
  title: z.string().trim().min(2, 'Name the programme').max(120),
  body: richTextField(1000, { length: 2, message: 'Describe the programme' }),
  icon: z.enum(JAMII_PROGRAM_ICONS).optional(),
});
export type JamiiProgramInput = z.infer<typeof jamiiProgramSchema>;

export const createCampaignSchema = z.object({
  title: z.string().trim().min(2, 'Give the campaign a title').max(140),
  summary: z.string().trim().min(2, 'Summarise what this raises for').max(280),
  body: richTextField(6000).optional().or(z.literal('')),
  goalKes: z.number().positive('Set a goal above zero').max(100_000_000),
  coverUrl: z.string().trim().max(2000).optional().or(z.literal('')),
  endsAt: z.string().optional().or(z.literal('')),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z.object({
  title: z.string().trim().min(2, 'Give the campaign a title').max(140),
  summary: z.string().trim().min(2, 'Summarise what this raises for').max(280),
  body: richTextField(6000).optional().or(z.literal('')),
  goalKes: z.number().positive('Set a goal above zero').max(100_000_000),
  coverUrl: z.string().trim().max(2000).optional().or(z.literal('')),
  endsAt: z.string().optional().or(z.literal('')),
  status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED']),
});
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export const campaignUpdateSchema = z.object({
  title: z.string().trim().min(2, 'Give the update a title').max(140),
  body: richTextField(4000, { length: 2, message: 'Write the update' }),
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
 * First step of applying for Our Jamii access: just an identifier, so
 * the form can tell someone "we already have your details" before
 * asking them to fill in anything. See @esoko/db's findJamiiApplicant.
 */
export const jamiiApplicantCheckSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your phone number or email'),
});
export type JamiiApplicantCheckInput = z.infer<typeof jamiiApplicantCheckSchema>;

/**
 * An application for Our Jamii access — the account may not exist yet
 * (a brand-new applicant) or may already (an existing CECF member whose
 * phone/email matched one on file), so `msisdn`/`county` are validated
 * as required only when the Server Action determines it's the
 * brand-new case; see apps/jamii's actionSubmitApplication. Sign-in is
 * granted once a staff member approves this, never automatically — see
 * @esoko/db's approveJamiiInterest and the admin app's /jamii-interest
 * screen.
 */
/**
 * Reserved so a group can't "link" a domain we already serve from —
 * esoko.co.ke itself, ourjamii.co.ke (this app's own primary domain),
 * or a bare subdomain of either. Checked case-insensitively against the
 * normalised hostname before it ever reaches Cloudflare.
 */
export const JAMII_RESERVED_DOMAIN_SUFFIXES = ['esoko.co.ke', 'ourjamii.co.ke'] as const;

/**
 * A group's custom domain for their Our Jamii page — see
 * @esoko/db's requestJamiiDomain and apps/jamii's dashboard settings
 * "Domain" panel. Deliberately strict: this is the one place a member
 * of the public types a string that later becomes a live DNS/TLS
 * target, so the shape is checked here (client + server, same schema)
 * before the DAL's own re-validation.
 *
 * - No scheme, path, port or trailing dot — a bare hostname only.
 * - Rejects IP literals (v4 or v6-looking) — a domain is required, not
 *   an address.
 * - At least one label + a plausible TLD (2+ alpha chars) so obvious
 *   junk ("localhost", "mchama") is rejected before hitting the DAL's
 *   reserved-suffix / uniqueness checks.
 */
export const jamiiDomainHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine((v) => !/^https?:\/\//.test(v) && !v.includes('/') && !v.includes(':'), {
    message: 'Enter just the domain, e.g. mchamawetu.org — no https:// or path',
  })
  .refine((v) => !/^\d{1,3}(\.\d{1,3}){3}$/.test(v) && !v.includes('['), {
    message: 'Enter a domain name, not an IP address',
  })
  .refine((v) => /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,}$/.test(v), {
    message: 'Enter a valid domain, e.g. mchamawetu.org',
  });
export type JamiiDomainHostnameInput = z.infer<typeof jamiiDomainHostnameSchema>;

export const requestJamiiDomainSchema = z.object({
  hostname: jamiiDomainHostnameSchema,
});
export type RequestJamiiDomainInput = z.infer<typeof requestJamiiDomainSchema>;

/**
 * A visitor writing to one org through its own public Contact page —
 * see @esoko/db's submitJamiiContactMessage and apps/jamii's
 * (site)/o/[slug]/contact/actions.ts. Deliberately separate from
 * jamiiInterestSchema below (that's "wants Our Jamii access", reviewed
 * platform-wide by Esoko staff); this is page-scoped and only ever
 * read by that page's own team.
 */
export const jamiiContactMessageSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: z.string().trim().max(32).optional().or(z.literal('')),
  subject: z.string().trim().max(160).optional().or(z.literal('')),
  message: z.string().trim().min(10, 'Say a little more — at least 10 characters').max(4000),
  // Honeypot — real visitors never see or fill this field (hidden via
  // CSS in the form); a bot filling it in is the signal to silently
  // drop the submission rather than tell the bot it was rejected.
  website2: z.string().max(0).optional().or(z.literal('')),
});
export type JamiiContactMessageInput = z.infer<typeof jamiiContactMessageSchema>;

export const jamiiInterestSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your phone number or email'),
  fullName: z.string().trim().min(2, 'Enter your name').max(120).optional().or(z.literal('')),
  msisdn: z.string().trim().regex(/^\+254(7|1)\d{8}$/, 'Enter a valid Kenyan mobile number').optional().or(z.literal('')),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').optional().or(z.literal('')),
  county: z.string().trim().max(80).optional().or(z.literal('')),
  organisationName: z.string().trim().max(160).optional().or(z.literal('')),
  message: z.string().trim().max(1000).optional().or(z.literal('')),
});
export type JamiiInterestInput = z.infer<typeof jamiiInterestSchema>;
