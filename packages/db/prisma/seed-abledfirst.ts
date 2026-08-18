import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { sniff, makeStorageKey, putObject } from '../src/storage';

const prisma = new PrismaClient();

/**
 * Demo content for AbledFirst Kenya — a real org profile (mission,
 * vision, programmes, governance) supplied by the org and CECF, seeded
 * here so the custom-domain homepage template (OrgHomeHero/
 * OrgHomeSections/OrgPageBanner) has something real to render against
 * instead of lorem ipsum. Content marked "to confirm" in the source
 * profile (registration number, phone, email, physical address,
 * verified impact figures) is deliberately left blank rather than
 * invented — see docs/proposals/our-jamii-custom-domains.md.
 *
 * Idempotent: reruns delete and recreate this org's page by slug, so
 * `pnpm --filter @esoko/db seed:abledfirst` is safe to run more than
 * once while iterating on the homepage template.
 */

const SLUG = 'abledfirst-kenya';
const LOGO_PATH = '/Users/ochiengodero/Documents/CECF/cecf-our-jamii/abled-first-org/abled-first-logo.jpeg';

const ABOUT_US = [
  'AbledFirst Kenya is a community-based organisation working so that disability, age or postcode never decides whether a person gets a fair chance. We exist because too many Kenyans with disabilities are counted in policy documents but not served by them.',
  "Our work sits at the meeting point of three groups who too often get left out of local development planning: persons with disabilities, whose rights are recognised in law but unevenly delivered on the ground; young people, whose talent outpaces the opportunities available to them; and underserved households, who carry the cost of services that never quite reach them.",
  "We do three things well. We advocate — helping people speak for themselves in the rooms where decisions about them are made. We equip — with assistive devices, skills, referrals and the paperwork that unlocks entitlements people are already owed. And we connect — linking members to county offices, employers, health services, training providers and each other.",
  'Everything we run is designed with the people it serves, not for them. Members sit on our programme committees, self-advocates lead our community forums, and no project is signed off without the voices of the people it affects. "Nothing about us, without us" is not a slogan we borrowed — it is how our programmes are built.',
].join('\n\n');

// icon values are @esoko/ui IconNames (see JAMII_PROGRAM_ICONS in
// packages/domain/src/jamii.ts) — never emoji, per that package's
// product-wide rule.
const PROGRAMS: { title: string; body: string; icon: string }[] = [
  {
    title: 'Disability rights advocacy & voice',
    icon: 'scales',
    body: 'Community forums, self-advocacy training and representation at ward and county level, so persons with disabilities take part in decisions about budgets, services and public facilities rather than hearing about them afterwards.',
  },
  {
    title: 'Assistive devices & access to entitlements',
    icon: 'key',
    body: 'Assessment referrals and provision of mobility, hearing and vision aids, paired with practical help to obtain NCPWD registration, disability cards and medical assessments.',
  },
  {
    title: 'Youth skills & livelihoods',
    icon: 'chart',
    body: 'Vocational and digital skills training, entrepreneurship coaching and start-up support for young people, with places reserved for young persons with disabilities.',
  },
  {
    title: 'Inclusive education & child support',
    icon: 'certificate',
    body: 'Keeping learners with disabilities in school: fee and materials support, teacher and peer sensitisation, accessibility improvements, and parent support groups.',
  },
  {
    title: 'Household resilience & caregiver support',
    icon: 'users',
    body: 'Savings and table-banking circles for members and caregivers, psychosocial support groups, and outreach linking underserved households to health, nutrition and social protection services.',
  },
];

const FAQ = [
  {
    q: 'Who does AbledFirst Kenya support?',
    a: 'Persons with disabilities of all ages, young people aged 18–35 seeking skills or work, caregivers and families (mostly women carrying unpaid care work), women and girls with disabilities facing compounded barriers, and underserved households where public services technically exist but rarely arrive.',
  },
  {
    q: 'How does AbledFirst Kenya stay accountable?',
    a: 'Programme funds and any campaign donations are held separately. Accounts are presented to members at general meetings, and every campaign supported through Our Jamii is reported back with what was raised, what it bought and what changed.',
  },
  {
    q: 'How can my organisation partner with you?',
    a: 'Fund a programme cycle or a specific need, offer attachments or employment to our graduates, provide technical support (accessibility auditing, M&E, digital systems), or co-deliver where your reach and ours overlap. Every partnership gets a named contact and a written agreement.',
  },
  {
    q: 'What does "Nothing about us, without us" mean in practice?',
    a: 'Members sit on our programme committees, self-advocates lead our community forums, and no project is signed off without the voices of the people it affects — participants, not cases.',
  },
];

/** role, personId placeholder key, and Membership role mapping. */
const TEAM: { name: string; role: 'CHAIRPERSON' | 'SECRETARY' | 'TREASURER' | 'OTHER'; customRole?: string }[] = [
  { name: 'James', role: 'CHAIRPERSON' },
  { name: 'Rosemary Akinyi', role: 'SECRETARY' },
  { name: 'Esther Malundu', role: 'TREASURER' },
  { name: 'Harold Kipchumba', role: 'OTHER', customRole: 'Programmes lead' },
  { name: 'Junior Kiplimo', role: 'OTHER', customRole: 'Youth representative' },
  { name: 'Isabel Jeptoo', role: 'OTHER', customRole: 'Self-advocate representative' },
];

function slugifyEmail(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/(^\.|\.$)/g, '');
}

async function main() {
  console.log('Seeding AbledFirst Kenya…');

  // Idempotent — wipe any previous run of this exact demo page first.
  // Delete the org's own Party FIRST — that cascades JamiiPage,
  // JamiiTeamMember (via pageId) and Membership (via orgId), which is
  // what stops the six team members' independent Party/Person rows
  // from still being referenced. Only once that's clear can those be
  // deleted too (matched by the demo-only email domain), or a rerun
  // collides on their unique msisdn/email.
  const existing = await prisma.jamiiPage.findUnique({ where: { slug: SLUG } });
  if (existing) {
    console.log('  existing page found, removing before reseed…');
    await prisma.party.delete({ where: { id: existing.organisationId } });
  }
  // Unconditional — a previous run can leave these behind even with no
  // JamiiPage present (e.g. it failed after this step but before the
  // page existed to look up next time), so this never depends on the
  // `existing` lookup above finding anything.
  await prisma.party.deleteMany({ where: { person: { email: { endsWith: '@abledfirst-kenya.demo.local' } } } });

  const orgParty = await prisma.$transaction(async (tx) => {
    const party = await tx.party.create({
      data: {
        kind: 'ORGANISATION',
        county: 'Nairobi',
        organisation: {
          create: {
            kind: 'CBO',
            officialName: 'AbledFirst Kenya',
            tags: ['disability-inclusion', 'youth', 'community-empowerment'],
          },
        },
        accounts: { create: [{ kind: 'GROUP_SAVINGS', currency: 'KES' }] },
      },
      include: { organisation: true },
    });

    await tx.jamiiPage.create({
      data: {
        organisationId: party.id,
        slug: SLUG,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        tagline: 'Voices Heard. Lives Transformed.',
        missionShort: 'Fostering empowerment and inclusion for persons with disabilities, young people and underserved communities across Kenya.',
        visionShort: 'Inclusive communities where no one is left behind.',
        // The three colours from AbledFirst's own template/brand —
        // crimson, cyan, gold.
        brandAccent: '#D81E56',
        brandAccentTwo: '#0E7F9C',
        brandAccentThree: '#B8720F',
        themeDefaultMode: 'DARK',
        aboutUs: ABOUT_US,
        faq: FAQ,
        programs: { create: PROGRAMS.map((p, i) => ({ ...p, position: i })) },
      },
    });

    // Six real people, each a genuine Party/Person so Membership (the
    // public Leadership page's data source) has something to point at —
    // msisdn/email here are placeholders never shown publicly (the
    // Leadership page renders name + role only).
    const people = [];
    for (const [i, member] of TEAM.entries()) {
      const person = await tx.party.create({
        data: {
          kind: 'PERSON',
          county: 'Nairobi',
          person: {
            create: {
              officialName: member.name,
              knownAs: member.name.split(' ')[0],
              msisdn: `+25470000${String(10 + i).padStart(4, '0')}`,
              email: `${slugifyEmail(member.name)}@abledfirst-kenya.demo.local`,
            },
          },
        },
      });
      people.push(person);

      await tx.membership.create({
        data: {
          personId: person.id,
          orgId: party.id,
          role: member.role,
          customRole: member.customRole,
        },
      });
    }

    // James (Chairperson) is also the page's first admin — same as any
    // founder via the self-serve /start wizard.
    const founder = people[0];
    if (!founder) throw new Error('TEAM list is empty — no founder to make page ADMIN');
    await tx.jamiiTeamMember.create({
      data: {
        pageId: party.id,
        personId: founder.id,
        inviteName: 'James',
        inviteEmail: `${slugifyEmail('James')}@abledfirst-kenya.demo.local`,
        role: 'ADMIN',
        acceptedAt: new Date(),
      },
    });

    return party;
  });

  // Logo — sniffed and stored through the exact same path
  // uploadPageAsset uses, so it's indistinguishable from a real upload.
  try {
    const buf = await readFile(LOGO_PATH);
    const check = sniff(buf, 'image/jpeg', 'abled-first-logo.jpeg');
    if (check.ok && check.mime) {
      const storageKey = makeStorageKey(check.mime);
      await putObject(storageKey, buf);
      await prisma.jamiiPage.update({
        where: { organisationId: orgParty.id },
        data: { logoStorageKey: storageKey, logoUrl: `/img/${storageKey}` },
      });
      console.log('  logo uploaded:', storageKey);
    } else {
      console.warn('  logo file did not pass the upload sniff check, skipping:', check.reason);
    }
  } catch (e) {
    console.warn('  could not read logo file, skipping logo upload:', (e as Error).message);
  }

  console.log(`Done. Page live at /o/${SLUG} (or via a custom domain in console mode — see the dashboard).`);
  console.log('Organisation partyId:', orgParty.id);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
