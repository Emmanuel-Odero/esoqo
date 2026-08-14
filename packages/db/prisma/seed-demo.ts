import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
// Relative import, not '@esoko/db' — this file lives inside that
// package, so importing it by package name would be a self-dependency
// pnpm doesn't wire up here the way it does for consumers.
import { ROLE_PRESETS, TICKETING_STAFF_CAPABILITIES } from '../src/capabilities';

const prisma = new PrismaClient();
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const pinHash = (pin: string) => hash(pin, ARGON);

/**
 * Demo/ticketing sample data — deliberately separate from prisma/seed.ts.
 *
 * seed.ts is reference data only, on purpose (see its own header): no
 * fake parties, no fake businesses, nothing a stakeholder could mistake
 * for real traction. This script is the opposite by design — every
 * name below is prefixed "Demo" specifically so it can never be
 * confused with a real registration, and it exists purely to give a
 * walkthrough something to click on: a transport company, an events
 * company, a customer, and one credential per ticketing role so anyone
 * can sign in as each kind of user without digging through the DB.
 *
 * Safe to re-run — every row is upserted or existence-checked first.
 *
 * Run: pnpm --filter @esoko/db seed:demo
 */

interface DemoSubject { partyId: string; msisdn: string; pin: string; label: string }

async function upsertSubject(input: {
  msisdn: string; officialName: string; knownAs: string; county: string; pin: string;
}): Promise<DemoSubject> {
  const existing = await prisma.person.findUnique({ where: { msisdn: input.msisdn } });
  const hashed = await pinHash(input.pin);

  const partyId = existing
    ? existing.partyId
    : (await prisma.party.create({ data: { kind: 'PERSON', county: input.county } })).id;

  if (existing) {
    await prisma.person.update({
      where: { partyId },
      data: { officialName: input.officialName, knownAs: input.knownAs },
    });
  } else {
    await prisma.person.create({
      data: { partyId, officialName: input.officialName, knownAs: input.knownAs, msisdn: input.msisdn },
    });
  }

  await prisma.userCredential.upsert({
    where: { personId: partyId },
    update: { pinHash: hashed, pinSetAt: new Date(), failedAttempts: 0, lockedUntil: null },
    create: { personId: partyId, pinHash: hashed, pinSetAt: new Date() },
  });

  return { partyId, msisdn: input.msisdn, pin: input.pin, label: input.knownAs };
}

async function upsertEnterprise(partyId: string, workRaw: string) {
  const existing = await prisma.enterprise.findFirst({ where: { partyId, workRaw } });
  if (existing) return existing;
  return prisma.enterprise.create({ data: { partyId, workRaw, isRegistered: true, hasKraPin: true } });
}

async function upsertTicketOrg(input: {
  enterpriseId: string; name: string; slug: string; vertical: 'EVENTS' | 'TRANSPORT'; contactPhone: string;
}) {
  return prisma.ticketOrg.upsert({
    where: { slug: input.slug },
    update: { name: input.name, status: 'ACTIVE' },
    create: {
      enterpriseId: input.enterpriseId, name: input.name, slug: input.slug, vertical: input.vertical,
      status: 'ACTIVE', contactPhone: input.contactPhone, contactEmail: `${input.slug}@example-demo.esoko`,
    },
  });
}

async function upsertOrgStaff(orgId: string, name: string, role: keyof typeof TICKETING_STAFF_CAPABILITIES, pin: string) {
  const existing = await prisma.ticketOrgStaff.findFirst({ where: { orgId, name } });
  const hashed = await pinHash(pin);
  if (existing) return prisma.ticketOrgStaff.update({ where: { id: existing.id }, data: { pinHash: hashed, role, active: true } });
  return prisma.ticketOrgStaff.create({ data: { orgId, name, pinHash: hashed, role, active: true } });
}

async function upsertVenue(orgId: string, name: string, address: string, county: string, capacity: number) {
  const existing = await prisma.venue.findFirst({ where: { orgId, name } });
  if (existing) return existing;
  return prisma.venue.create({ data: { orgId, name, address, county, capacity } });
}

async function upsertRoute(orgId: string, originName: string, destinationName: string, distanceKm: number) {
  const existing = await prisma.route.findFirst({ where: { orgId, originName, destinationName } });
  if (existing) return existing;
  return prisma.route.create({ data: { orgId, originName, destinationName, distanceKm } });
}

async function upsertListing(input: {
  orgId: string; title: string; slug: string; description: string; venueId?: string; routeId?: string;
}) {
  return prisma.listing.upsert({
    where: { slug: input.slug },
    update: { title: input.title, status: 'PUBLISHED', venueId: input.venueId, routeId: input.routeId },
    create: {
      orgId: input.orgId, title: input.title, slug: input.slug, description: input.description,
      venueId: input.venueId, routeId: input.routeId, status: 'PUBLISHED',
    },
  });
}

async function upsertTicketClass(listingId: string, name: string, priceKes: number, capacity: number, seated: boolean) {
  const existing = await prisma.ticketClass.findFirst({ where: { listingId, name } });
  if (existing) return existing;
  return prisma.ticketClass.create({ data: { listingId, name, priceKes, capacity, seated } });
}

/** Schedules an occurrence and, for any seated class on the listing,
 *  generates its numbered seats — same logic as createSchedule in
 *  dal/ticketing.ts, duplicated here because seed scripts run outside
 *  the DAL/Ctx boundary (same precedent as seed.ts's direct
 *  prisma.staffUser.upsert). */
async function scheduleOccurrence(listingId: string, departAt: Date, vehicleOrHallLabel?: string) {
  const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId }, include: { ticketClasses: true } });
  const existing = await prisma.listingSchedule.findFirst({ where: { listingId, departAt } });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    const schedule = await tx.listingSchedule.create({ data: { listingId, departAt, vehicleOrHallLabel } });
    // Labels run continuously across every seated class — see the
    // matching comment in dal/ticketing.ts's createSchedule.
    let nextLabel = 1;
    for (const tc of listing.ticketClasses) {
      if (!tc.seated) continue;
      await tx.seat.createMany({
        data: Array.from({ length: tc.capacity }, (_, i) => ({
          scheduleId: schedule.id, ticketClassId: tc.id, label: String(nextLabel + i),
        })),
      });
      nextLabel += tc.capacity;
    }
    return schedule;
  });
}

function daysFromNow(days: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function main() {
  console.log('seeding ticketing demo data…\n');

  // ── demo subjects — one per side of the walkthrough ──────────────
  const customer = await upsertSubject({
    msisdn: '+254700111001', officialName: 'Demo Customer', knownAs: 'Demo Customer',
    county: 'Nairobi', pin: '135790',
  });
  const eventsOwner = await upsertSubject({
    msisdn: '+254700111002', officialName: 'Demo Event Organiser', knownAs: 'Demo Event Organiser',
    county: 'Nairobi', pin: '246801',
  });
  const transportOwner = await upsertSubject({
    msisdn: '+254700111003', officialName: 'Demo Transport Owner', knownAs: 'Demo Transport Owner',
    county: 'Nairobi', pin: '357912',
  });
  console.log(`  subjects: ${customer.label}, ${eventsOwner.label}, ${transportOwner.label}`);

  // ── one Esoko ops account scoped to ticketing oversight ──────────
  const opsPin = '592837';
  await prisma.staffUser.upsert({
    where: { email: 'demo-ticketing-ops@esoko.co.ke' },
    update: { capabilities: [...ROLE_PRESETS.ESOKO_OPS] },
    create: {
      email: 'demo-ticketing-ops@esoko.co.ke', name: 'Demo Ticketing Ops',
      pinHash: await pinHash(opsPin), rolePreset: 'ESOKO_OPS',
      capabilities: [...ROLE_PRESETS.ESOKO_OPS], mustChangePin: false,
    },
  });
  console.log(`  ops staff: demo-ticketing-ops@esoko.co.ke`);

  // ── events organiser ──────────────────────────────────────────────
  const eventsEnterprise = await upsertEnterprise(eventsOwner.partyId, 'event promotion');
  const eventsOrg = await upsertTicketOrg({
    enterpriseId: eventsEnterprise.id, name: 'Demo Live Events Co', slug: 'demo-live-events-co',
    vertical: 'EVENTS', contactPhone: eventsOwner.msisdn,
  });
  const eventsAdmin = await upsertOrgStaff(eventsOrg.id, 'Demo Events Admin', 'ADMIN', '111222');
  const eventsScanner = await upsertOrgStaff(eventsOrg.id, 'Demo Gate Scanner', 'SCANNER', '222333');

  const amphitheatre = await upsertVenue(eventsOrg.id, 'Demo Amphitheatre', 'Ngong Road, Nairobi', 'Nairobi', 2000);

  const afrobeat = await upsertListing({
    orgId: eventsOrg.id, title: 'Demo Afrobeat Night', slug: 'demo-afrobeat-night',
    description: 'A sample event listing — Afrobeat acts, food stalls, gates open at 6pm.',
    venueId: amphitheatre.id,
  });
  const afrobeatRegular = await upsertTicketClass(afrobeat.id, 'Regular', 1500, 200, false);
  const afrobeatVip = await upsertTicketClass(afrobeat.id, 'VIP', 5000, 50, false);
  const afrobeatSchedule = await scheduleOccurrence(afrobeat.id, daysFromNow(14, 18), 'Main Stage');
  await scheduleOccurrence(afrobeat.id, daysFromNow(21, 18), 'Main Stage');

  const comedy = await upsertListing({
    orgId: eventsOrg.id, title: 'Demo Comedy Live', slug: 'demo-comedy-live',
    description: 'A sample event listing — stand-up comedy, one night only.',
    venueId: amphitheatre.id,
  });
  await upsertTicketClass(comedy.id, 'Regular', 800, 300, false);
  await upsertTicketClass(comedy.id, 'VIP', 2500, 40, false);
  await scheduleOccurrence(comedy.id, daysFromNow(10, 19), 'Indoor Hall');

  console.log(`  events org: ${eventsOrg.name} (${eventsOrg.slug}) — 2 listings`);

  // ── transport organiser ───────────────────────────────────────────
  const transportEnterprise = await upsertEnterprise(transportOwner.partyId, 'road transport');
  const transportOrg = await upsertTicketOrg({
    enterpriseId: transportEnterprise.id, name: 'Demo Express Coaches', slug: 'demo-express-coaches',
    vertical: 'TRANSPORT', contactPhone: transportOwner.msisdn,
  });
  const transportAdmin = await upsertOrgStaff(transportOrg.id, 'Demo Transport Admin', 'ADMIN', '333444');
  const transportManager = await upsertOrgStaff(transportOrg.id, 'Demo Transport Manager', 'MANAGER', '444555');
  const transportScanner = await upsertOrgStaff(transportOrg.id, 'Demo Boarding Scanner', 'SCANNER', '555666');

  const nbomsa = await upsertRoute(transportOrg.id, 'Nairobi', 'Mombasa', 485);
  const nbokis = await upsertRoute(transportOrg.id, 'Nairobi', 'Kisumu', 340);

  const coastCoach = await upsertListing({
    orgId: transportOrg.id, title: 'Demo Nairobi–Mombasa Coach', slug: 'demo-nairobi-mombasa-coach',
    description: 'A sample transport listing — overnight coach, reserved seating.',
    routeId: nbomsa.id,
  });
  await upsertTicketClass(coastCoach.id, 'Economy seat', 1200, 44, true);
  await upsertTicketClass(coastCoach.id, 'Business seat', 2500, 10, true);
  const coastSchedule = await scheduleOccurrence(coastCoach.id, daysFromNow(2, 21), 'KDA 001A');
  await scheduleOccurrence(coastCoach.id, daysFromNow(3, 21), 'KDA 001A');

  const lakeShuttle = await upsertListing({
    orgId: transportOrg.id, title: 'Demo Nairobi–Kisumu Shuttle', slug: 'demo-nairobi-kisumu-shuttle',
    description: 'A sample transport listing — daytime shuttle, reserved seating.',
    routeId: nbokis.id,
  });
  await upsertTicketClass(lakeShuttle.id, 'Economy seat', 1000, 14, true);
  await scheduleOccurrence(lakeShuttle.id, daysFromNow(1, 7), 'KDB 220B');

  console.log(`  transport org: ${transportOrg.name} (${transportOrg.slug}) — 2 listings`);

  // ── one sample booking so /me/tickets has something to show ──────
  const existingBooking = await prisma.booking.findFirst({ where: { buyerPartyId: customer.partyId } });
  if (!existingBooking) {
    const seat = await prisma.seat.findFirstOrThrow({ where: { scheduleId: coastSchedule.id, status: 'AVAILABLE' } });
    await prisma.$transaction(async (tx) => {
      await tx.seat.update({ where: { id: seat.id }, data: { status: 'BOOKED' } });
      const economyClass = await tx.ticketClass.findFirstOrThrow({ where: { listingId: coastCoach.id, name: 'Economy seat' } });
      await tx.booking.create({
        data: {
          scheduleId: coastSchedule.id, buyerPartyId: customer.partyId,
          buyerName: 'Demo Customer', buyerMsisdn: customer.msisdn,
          status: 'PAID', paymentMethod: 'CASH', totalKes: economyClass.priceKes, paidAt: new Date(),
          tickets: { create: [{
            ticketClassId: economyClass.id, seatId: seat.id, code: `DEMO${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
            holderName: 'Demo Customer', holderMsisdn: customer.msisdn, priceKes: economyClass.priceKes, status: 'VALID',
          }] },
        },
      });
    });
    console.log('  sample booking: 1 paid coach ticket for Demo Customer');
  }

  // ── one afrobeat GA ticket too, so both verticals show up in /me/tickets
  const existingGaBooking = await prisma.booking.count({
    where: { buyerPartyId: customer.partyId, schedule: { listingId: afrobeat.id } },
  });
  if (existingGaBooking === 0) {
    await prisma.booking.create({
      data: {
        scheduleId: afrobeatSchedule.id, buyerPartyId: customer.partyId,
        buyerName: 'Demo Customer', buyerMsisdn: customer.msisdn,
        status: 'PAID', paymentMethod: 'CASH', totalKes: afrobeatRegular.priceKes, paidAt: new Date(),
        tickets: { create: [{
          ticketClassId: afrobeatRegular.id, code: `DEMO${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          holderName: 'Demo Customer', holderMsisdn: customer.msisdn, priceKes: afrobeatRegular.priceKes, status: 'VALID',
        }] },
      },
    });
    console.log('  sample booking: 1 paid event ticket for Demo Customer');
  }
  void afrobeatVip; // reserved for future demo variety — kept unused-but-named for clarity of intent

  // ── credential summary ────────────────────────────────────────────
  console.log('\n── demo credentials ──────────────────────────────────────────');
  console.log('Subjects sign in at http://localhost:3001/signin (phone + PIN):');
  console.log(`  Customer            ${customer.msisdn}      PIN ${customer.pin}   — /me/tickets has sample bookings`);
  console.log(`  Events org owner    ${eventsOwner.msisdn}      PIN ${eventsOwner.pin}   — /me/organiser → ${eventsOrg.name}`);
  console.log(`  Transport org owner ${transportOwner.msisdn}      PIN ${transportOwner.pin}   — /me/organiser → ${transportOrg.name}`);
  console.log('\nOrg staff sign in at http://localhost:3001/org-staff/<org-slug> (name + PIN):');
  console.log(`  ${eventsOrg.slug}`);
  console.log(`    ${eventsAdmin.name.padEnd(20)} ADMIN     PIN 111222`);
  console.log(`    ${eventsScanner.name.padEnd(20)} SCANNER   PIN 222333`);
  console.log(`  ${transportOrg.slug}`);
  console.log(`    ${transportAdmin.name.padEnd(20)} ADMIN     PIN 333444`);
  console.log(`    ${transportManager.name.padEnd(20)} MANAGER   PIN 444555`);
  console.log(`    ${transportScanner.name.padEnd(20)} SCANNER   PIN 555666`);
  console.log('\nEsoko ops (internal, apps/admin) sign in with email + PIN:');
  console.log(`  demo-ticketing-ops@esoko.co.ke   PIN ${opsPin}   — role ESOKO_OPS`);
  console.log('\nPublic browse (no sign-in): http://localhost:3000/tickets or http://localhost:3001/tickets');
  console.log('\nAll of the above are demo-only rows, prefixed "Demo" throughout — safe to re-run this script.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
