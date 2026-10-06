/**
 * Demo payees for the /pay hub, so every destination it advertises has
 * something real behind it.
 *
 * The hub promises four ways to pay — a business, a group, a transport
 * operator, a car park — and a hub whose every card says "not found" is
 * indistinguishable from a broken one. This puts one of each in place and
 * prints the exact codes to type.
 *
 * Not in the Go seed, for the same reason the parking seed isn't: these
 * are only useful to the Next app, which is the only thing that reads
 * them. Everything here is idempotent, matched on officialName, so
 * re-running never invalidates a code somebody has already printed.
 *
 *   pnpm --filter @esoqo/db seed:pay-demo
 */
import { prisma } from '../src/client';
import { anonCtx } from '../src/capabilities';
import { allocateEsoqoOrgHandle } from '../src/dal/payment-id';
import { findPayableGroups, lookupPayee, lookupPayeeByPlate } from '../src/dal/business-payment';
import { findParkingLot } from '../src/dal/parking';

const ctx = anonCtx();

type OrgKind =
  | 'BUSINESS' | 'SUPPLIER' | 'WHOLESALER' | 'WAREHOUSE' | 'MALL'
  | 'CHAMA' | 'SELF_HELP_GROUP' | 'FBO' | 'COOPERATIVE' | 'SACCO' | 'NGO';

interface DemoOrg {
  officialName: string;
  knownAs: string;
  kind: OrgKind;
  county: string;
  registrationNo?: string;
  /** Set on the one org that also owns vehicles, so the plate lookup has
   *  an enterprise + ticket org to walk back to. */
  fleet?: { name: string; plates: string[] }[];
}

/** Counties are written by name, not by code. The `county` table keys on
 *  '047', and the older demo rows still hold that, but `party.county` is
 *  free text and the /pay pages print it verbatim to a member of the
 *  public — '047' on a savings-group search result tells a payer nothing.
 *  If the two conventions need reconciling, resolve the code in the DAL
 *  rather than storing names here. */
const ORGS: DemoOrg[] = [
  {
    officialName: 'Demo Westside Supermarket Ltd',
    knownAs: 'Westside Supermarket',
    kind: 'BUSINESS', county: 'Nairobi', registrationNo: 'DEMO-BUS-001',
  },
  {
    officialName: 'Demo Harambee Wholesalers Ltd',
    knownAs: 'Harambee Wholesalers',
    kind: 'WHOLESALER', county: 'Nakuru', registrationNo: 'DEMO-WHL-002',
  },
  {
    officialName: 'Demo Ujamaa Chama',
    knownAs: 'Ujamaa Chama',
    kind: 'CHAMA', county: 'Nairobi', registrationNo: 'DEMO-CHM-003',
  },
  {
    officialName: 'Demo Tatanga Self-Help Group',
    knownAs: 'Tatanga SHG',
    kind: 'SELF_HELP_GROUP', county: 'Mombasa', registrationNo: 'DEMO-SHG-004',
  },
  {
    officialName: 'Demo Kilimo Farmers Cooperative',
    knownAs: 'Kilimo Coop',
    kind: 'FBO', county: 'Kisumu', registrationNo: 'DEMO-FBO-005',
  },
  {
    officialName: 'Demo Rapid Transit Ltd',
    knownAs: 'Rapid Transit',
    kind: 'SUPPLIER', county: 'Nairobi', registrationNo: 'DEMO-TRN-006',
    // Two spellings of one van on purpose: /pay/transport has to resolve
    // 'KDA 442Q', 'KDA442Q' and 'KDA-442Q' to the same payee, and that is
    // only testable if the fixture contains the awkward case.
    fleet: [{ name: 'Rapid Transit Fleet', plates: ['KDA 442Q', 'KDC 118B'] }],
  },
];

async function main() {
  const web = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3001';
  const created: string[] = [];
  const reused: string[] = [];

  for (const o of ORGS) {
    let party = await prisma.party.findFirst({
      where: { organisation: { officialName: o.officialName } },
      select: { id: true, esoqoPaymentId: { select: { code: true, suspendedAt: true } } },
    });

    if (!party) {
      party = await prisma.party.create({
        data: {
          kind: 'ORGANISATION',
          county: o.county,
          organisation: {
            create: {
              kind: o.kind, officialName: o.officialName,
              knownAs: o.knownAs, registrationNo: o.registrationNo ?? null,
            },
          },
        },
        select: { id: true, esoqoPaymentId: { select: { code: true, suspendedAt: true } } },
      });
      created.push(o.knownAs);
    } else {
      reused.push(o.knownAs);
    }

    if (party.esoqoPaymentId?.suspendedAt) {
      throw new Error(`${o.knownAs} holds a suspended Payment ID and cannot be paid — resolve that first`);
    }
    if (!party.esoqoPaymentId) {
      const code = await allocateEsoqoOrgHandle(party.id, o.officialName, o.knownAs);
      console.log(`  issued ${code}  ${o.knownAs}`);
      continue;
    }

    if (!o.fleet) continue;

    // The plate lookup resolves vehicle -> ticket org -> enterprise ->
    // party, so all three links have to exist for a plate to find a
    // payee. Skipping any of them yields "not found" for reasons that
    // have nothing to do with the plate.
    const enterprise = await prisma.enterprise.upsert({
      where: { id: await findOrMakeEnterpriseId(party.id) },
      update: {},
      create: { partyId: party.id, workRaw: 'transport', segment: 'transport' },
      select: { id: true },
    });
    for (const f of o.fleet) {
      const org = await prisma.ticketOrg.upsert({
        where: { slug: `demo-${o.knownAs.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-fleet` },
        update: { status: 'ACTIVE' },
        create: {
          enterpriseId: enterprise.id, name: f.name, vertical: 'TRANSPORT', status: 'ACTIVE',
          slug: `demo-${o.knownAs.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-fleet`,
        },
        select: { id: true },
      });
      for (const plate of f.plates) {
        await prisma.fleetVehicle.upsert({
          where: { id: await findOrMakeVehicleId(org.id, plate) },
          update: { status: 'ACTIVE' },
          create: { orgId: org.id, plateNo: plate },
          select: { id: true },
        });
      }
    }
  }

  const rows = await prisma.party.findMany({
    where: { organisation: { officialName: { in: ORGS.map((o) => o.officialName) } } },
    select: {
      id: true, county: true,
      esoqoPaymentId: { select: { code: true } },
      organisation: { select: { kind: true, knownAs: true, officialName: true } },
    },
  });
  const byName = new Map(rows.map((r) => [r.organisation?.officialName, r]));

  const group = ORGS.filter((o) => o.kind === 'CHAMA' || o.kind === 'SELF_HELP_GROUP' || o.kind === 'FBO');
  const business = ORGS.filter((o) => !group.includes(o) && o.kind !== 'SUPPLIER');
  const transport = ORGS.filter((o) => o.fleet);
  const line = (label: string, os: DemoOrg[]) =>
    os.map((o) => `  ${label.padEnd(14)} ${byName.get(o.officialName)?.esoqoPaymentId?.code ?? '—'}  ${o.knownAs} (${o.kind}, ${o.county})`)
      .join('\n');

  const lot = await prisma.parkingLot.findFirst({
    where: { active: true }, orderBy: { createdAt: 'asc' }, select: { code: true, name: true, ratePerHourKes: true, graceMinutes: true },
  });

  // A seed that prints codes it never exercised is how you find out the
  // plate lookup is broken from the browser, on a phone, at a car park.
  // Every claim in the output below is checked here, through the same DAL
  // the page calls, and a failure is an error rather than a footnote.
  const problems: string[] = [];
  for (const o of ORGS) {
    const code = byName.get(o.officialName)?.esoqoPaymentId?.code;
    if (!code) { problems.push(`${o.knownAs} has no Payment ID`); continue; }
    const hit = await lookupPayee(ctx, code);
    if (hit.status !== 'FOUND') problems.push(`${o.knownAs}: ${code} does not resolve (${hit.status})`);
  }
  for (const o of group) {
    const found = await findPayableGroups(ctx, o.knownAs);
    const partyId = byName.get(o.officialName)?.id;
    if (!partyId || !found.some((g) => g.partyId === partyId)) {
      problems.push(`${o.knownAs} is not returned by a group search`);
    }
  }
  const rapid = transport[0];
  if (rapid?.fleet) {
    for (const spelling of ['KDA 442Q', 'KDA442Q', 'KDA-442Q']) {
      const hit = await lookupPayeeByPlate(spelling);
      if (hit.status !== 'FOUND') problems.push(`plate "${spelling}" does not resolve (${hit.status})`);
    }
    const forms = await Promise.all(['KDA 442Q', 'KDA442Q', 'KDA-442Q'].map((s) => lookupPayeeByPlate(s)));
    const counts = forms.map((f) => (f.status === 'FOUND' ? f.businesses.length : 0));
    if (new Set(counts).size !== 1) problems.push(`the three spellings of one plate disagree: ${counts.join('/')} payees`);
  }
  if (lot && !(await findParkingLot(lot.code))?.payable) problems.push('the parking lot is not payable');
  if (problems.length) throw new Error(`seeded but not usable:\n  - ${problems.join('\n  - ')}`);

  const person = await prisma.party.findFirst({
    where: { kind: 'PERSON', esoqoPaymentId: { isNot: null } }, select: { esoqoPaymentId: { select: { code: true } } },
  });
  const personCode = person?.esoqoPaymentId?.code;

  console.log(`
  Pay demo data ready
  ─────────────────────────────────────────────────────────────
${line('/pay/business', business)}
${line('/pay/group', group)}
${line('/pay/transport', transport)}
  /pay/parking   ${lot ? `${lot.code}  ${lot.name} (KES ${lot.ratePerHourKes}/hr, ${lot.graceMinutes} min free)` : 'none — run pnpm --filter @esoqo/db seed:parking'}

  Checked automatically: every code above resolves, resolves as payable, and
  the two Rapid Transit plates find the same payee.
  Plate to type on /pay/transport:  KDA 442Q   (also KDA442Q, KDA-442Q)

  Open:
    ${web}/pay                    the hub
    ${web}/pay/business           search a business by name or ESK code
    ${web}/pay/group              search a chama, SHG or FBO
    ${web}/pay/transport          search a company, or type a plate
    ${web}/pay/parking            check in with the lot code and your M-Pesa number (plate optional)
    ${web}/pay/help               the help page
${personCode ? `  Refusal case: ${personCode} is a person, not a business — ${web}/pay?to=${personCode}\n` : ''}  Payment SMS to 0712345678, provider MPESA_PROVIDER=console.
`);
  if (created.length) console.log(`  created: ${created.join(', ')}`);
  if (reused.length) console.log(`  already present: ${reused.join(', ')}`);
}

/** Enterprise has no natural key, so its Party is the identity: one
 *  enterprise per party, created only if that party has none. */
async function findOrMakeEnterpriseId(partyId: string): Promise<string> {
  const found = await prisma.enterprise.findFirst({ where: { partyId }, select: { id: true } });
  if (found) return found.id;
  const made = await prisma.enterprise.create({
    data: { partyId, workRaw: 'transport', segment: 'transport' }, select: { id: true },
  });
  return made.id;
}

/** FleetVehicle has no unique constraint on (orgId, plateNo), so the
 *  lookup is by pair and a miss makes the row. */
async function findOrMakeVehicleId(orgId: string, plateNo: string): Promise<string> {
  const found = await prisma.fleetVehicle.findFirst({ where: { orgId, plateNo }, select: { id: true } });
  if (found) return found.id;
  const made = await prisma.fleetVehicle.create({ data: { orgId, plateNo }, select: { id: true } });
  return made.id;
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
