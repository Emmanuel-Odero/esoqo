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
  // Free text when orgKind is OTHER — same convention as
  // createOwnGroup's orgKindOther (dal/groups.ts), so a group that
  // picks "Other" can still say what it actually is.
  orgKindOther: z.string().trim().max(80).optional().or(z.literal('')),
  officialName: z.string().trim().min(2, 'Give your organisation a name').max(120),
  county: z.string().trim().min(2, 'Choose a county'),
  ward: z.string().trim().max(80).optional().or(z.literal('')),
  registrationNo: z.string().trim().max(60).optional().or(z.literal('')),
  memberCount: z.number().int().positive().max(100_000).optional(),
  tagline: z.string().trim().max(120).optional().or(z.literal('')),
}).refine(
  (v) => v.orgKind !== 'OTHER' || Boolean(v.orgKindOther?.trim()),
  { message: 'Say what kind of organisation this is', path: ['orgKindOther'] },
);
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
  // Only worth setting when the auto-derived title/description
  // (buildOrgMetadata in apps/jamii/src/lib/seo.ts) is genuinely wrong
  // for search — most orgs should leave these blank.
  seoTitle: z.string().trim().max(70).optional().or(z.literal('')),
  seoDescription: z.string().trim().max(160).optional().or(z.literal('')),
});
export type JamiiPageProfileInput = z.infer<typeof jamiiPageProfileSchema>;

/**
 * The About page's "At a glance" card (org type, county/ward,
 * registration number) — Organisation/Party fields, edited from the
 * same About screen as jamiiPageProfileSchema's aboutUs/mission/vision
 * but written through a separate DAL call (updateJamiiOrgProfile),
 * since they live on a different table.
 */
export const jamiiOrgProfileSchema = z.object({
  officialName: z.string().trim().min(2, 'Give your organisation a name').max(120).optional(),
  orgKind: z.enum(JAMII_ORG_KINDS as [string, ...string[]]).optional(),
  // Free text when orgKind is OTHER — see startJamiiPageSchema's own
  // orgKindOther comment; every "Other" choice in this app gets a
  // paired free-text field, not a dead end.
  orgKindOther: z.string().trim().max(80).optional().or(z.literal('')),
  // Free-form, not limited to JAMII_CAUSES — that list is only a
  // suggestion at /start; an org may already have tags outside it
  // (e.g. seeded data), so this must accept whatever's already there.
  tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  county: z.string().trim().min(2, 'Choose a county').optional(),
  ward: z.string().trim().max(80).optional().or(z.literal('')),
  registrationNo: z.string().trim().max(60).optional().or(z.literal('')),
  memberCount: z.number().int().positive().max(100_000).optional(),
}).refine(
  (v) => v.orgKind !== 'OTHER' || Boolean(v.orgKindOther?.trim()),
  { message: 'Say what kind of organisation this is', path: ['orgKindOther'] },
);
export type JamiiOrgProfileInput = z.infer<typeof jamiiOrgProfileSchema>;

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

/**
 * Homepage block builder (Phase 2) — see JamiiPageBlock in schema.prisma
 * for the table this validates writes into, and OrgHomeSections.tsx /
 * apps/jamii/src/components/blocks/ for how each type renders publicly.
 *
 * STATS_TICKER/EXPLORE_GRID/ACTIVE_CAMPAIGN carry no config — they're
 * fully computed from the page/org at render time, same as today's
 * pre-Phase-2 homepage. The rest are genuinely editable content.
 */
export const jamiiBlockDataSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('STATS_TICKER'), data: z.object({}) }),
  z.object({ type: z.literal('EXPLORE_GRID'), data: z.object({}) }),
  z.object({ type: z.literal('ACTIVE_CAMPAIGN'), data: z.object({}) }),
  z.object({
    type: z.literal('DONATE_BAND'),
    data: z.object({
      heading: z.string().trim().max(140).optional().or(z.literal('')),
      body: z.string().trim().max(600).optional().or(z.literal('')),
      listItems: z.array(z.string().trim().max(200)).max(6).optional(),
    }),
  }),
  z.object({
    type: z.literal('RICH_TEXT'),
    data: z.object({
      heading: z.string().trim().max(140).optional().or(z.literal('')),
      html: richTextField(8000),
    }),
  }),
  z.object({
    type: z.literal('TESTIMONIAL'),
    data: z.object({
      quote: z.string().trim().min(2, 'Enter a quote').max(600),
      name: z.string().trim().min(2, 'Enter a name').max(120),
      role: z.string().trim().max(120).optional().or(z.literal('')),
    }),
  }),
  z.object({
    type: z.literal('PHOTO_STRIP'),
    data: z.object({ photoIds: z.array(z.string().uuid()).max(12) }),
  }),
  // Generic-CMS block library (Phase 5) — see JamiiBlockType's own
  // comment in schema.prisma for the general-purpose vs.
  // reads-live-data split these 12 types follow.
  z.object({
    type: z.literal('HERO'),
    data: z.object({
      heading: z.string().trim().min(1, 'Enter a heading').max(140),
      subheading: z.string().trim().max(280).optional().or(z.literal('')),
      imageUrl: z.string().trim().max(2000).optional().or(z.literal('')),
      ctaLabel: z.string().trim().max(40).optional().or(z.literal('')),
      ctaHref: z.string().trim().max(2000).optional().or(z.literal('')),
    }),
  }),
  z.object({
    type: z.literal('CTA_BUTTON'),
    data: z.object({
      heading: z.string().trim().max(140).optional().or(z.literal('')),
      body: z.string().trim().max(400).optional().or(z.literal('')),
      buttonLabel: z.string().trim().min(1, 'Enter a button label').max(40),
      buttonHref: z.string().trim().min(1, 'Enter a link').max(2000),
    }),
  }),
  z.object({
    type: z.literal('IMAGE_TEXT'),
    data: z.object({
      heading: z.string().trim().max(140).optional().or(z.literal('')),
      html: richTextField(4000),
      imageUrl: z.string().trim().max(2000).optional().or(z.literal('')),
      imagePosition: z.enum(['left', 'right']).default('right'),
    }),
  }),
  z.object({
    type: z.literal('VIDEO_EMBED'),
    data: z.object({
      heading: z.string().trim().max(140).optional().or(z.literal('')),
      url: z.string().trim().min(1, 'Paste a video URL').max(2000),
    }),
  }),
  z.object({
    type: z.literal('MAP_EMBED'),
    data: z.object({
      heading: z.string().trim().max(140).optional().or(z.literal('')),
      embedUrl: z.string().trim().min(1, 'Paste a Google Maps embed URL').max(2000),
    }),
  }),
  z.object({
    type: z.literal('COLUMNS'),
    data: z.object({
      heading: z.string().trim().max(140).optional().or(z.literal('')),
      columns: z.array(z.object({
        heading: z.string().trim().max(80).optional().or(z.literal('')),
        html: richTextField(1000),
      })).min(1).max(3),
    }),
  }),
  z.object({
    type: z.literal('SPACER'),
    data: z.object({ height: z.number().int().min(8).max(160).default(48) }),
  }),
  z.object({
    type: z.literal('PROGRAMS_LIST'),
    data: z.object({ heading: z.string().trim().max(140).optional().or(z.literal('')) }),
  }),
  z.object({
    type: z.literal('TEAM_GRID'),
    data: z.object({ heading: z.string().trim().max(140).optional().or(z.literal('')) }),
  }),
  z.object({
    type: z.literal('GALLERY_GRID'),
    data: z.object({ heading: z.string().trim().max(140).optional().or(z.literal('')) }),
  }),
  z.object({
    type: z.literal('FAQ_ACCORDION'),
    data: z.object({ heading: z.string().trim().max(140).optional().or(z.literal('')) }),
  }),
  z.object({
    type: z.literal('CONTACT_FORM'),
    data: z.object({
      heading: z.string().trim().max(140).optional().or(z.literal('')),
      body: z.string().trim().max(400).optional().or(z.literal('')),
    }),
  }),
]);

/** One row of the whole-list "save the entire block array atomically"
 *  Server Action — same shape as jamiiFaqSchema's whole-list replace.
 *  `id` is present when editing an existing block, absent for one just
 *  added client-side (the DAL treats a missing id as "create"). */
export const jamiiPageBlockSchema = z.object({ id: z.string().uuid().optional(), visible: z.boolean() })
  .and(jamiiBlockDataSchema);
export const jamiiPageBlocksSchema = z.array(jamiiPageBlockSchema).max(20);
export type JamiiPageBlockInput = z.infer<typeof jamiiPageBlockSchema>;

/**
 * Generic CMS — see JamiiSitePage/JamiiNavItem in schema.prisma. The
 * dashboard's "Pages" screen only ever asks for a title (the DAL
 * derives + dedupes the slug, same as createJamiiPage does for the org
 * slug itself); SEO fields are edited separately, once the page exists.
 */
export const jamiiCreateSitePageSchema = z.object({
  title: z.string().trim().min(2, 'Give the page a title').max(80),
});
export type JamiiCreateSitePageInput = z.infer<typeof jamiiCreateSitePageSchema>;

export const jamiiUpdateSitePageSchema = z.object({
  title: z.string().trim().min(2, 'Give the page a title').max(80).optional(),
  seoTitle: z.string().trim().max(70).optional().or(z.literal('')),
  seoDescription: z.string().trim().max(160).optional().or(z.literal('')),
  ogImageUrl: z.string().trim().max(2000).optional().or(z.literal('')),
});
export type JamiiUpdateSitePageInput = z.infer<typeof jamiiUpdateSitePageSchema>;

/**
 * The Navigation screen's whole-list "save the entire ordered array
 * atomically" Server Action — same shape as jamiiPageBlocksSchema.
 * `targetSitePageId`/`externalUrl` are cross-checked against
 * `targetKind` here so a malformed row (e.g. SITE_PAGE with no id)
 * never reaches the DAL — refine() over discriminatedUnion because the
 * two target fields are optional siblings, not literal-tagged variants.
 */
export const jamiiNavItemSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1, 'Give this nav item a label').max(40),
  visible: z.boolean(),
  openInNewTab: z.boolean().default(false),
  targetKind: z.enum(['SITE_PAGE', 'EXTERNAL_URL']),
  targetSitePageId: z.string().uuid().optional(),
  externalUrl: z.string().trim().max(2000).optional().or(z.literal('')),
}).refine(
  (v) => (v.targetKind === 'SITE_PAGE' ? Boolean(v.targetSitePageId) : Boolean(v.externalUrl?.trim())),
  { message: 'Choose a page, or enter a URL' },
);
export const jamiiNavItemsSchema = z.array(jamiiNavItemSchema).max(24);
export type JamiiNavItemInput = z.infer<typeof jamiiNavItemSchema>;
