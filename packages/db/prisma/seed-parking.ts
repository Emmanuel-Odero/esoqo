/**
 * A demo car park, so the parking flow has somewhere real to be tried.
 *
 * Not in the Go seed because it does not need to be: parking is a Next
 * server action over the same DAL the payment flow already uses, and
 * putting a PRK code in the middle of demo_unified_identity.go would
 * mean the Go seed had to know about a table it otherwise never touches.
 * This is idempotent — re-running reuses the same operator and the same
 * lot, so the printed code stays stable across a `pnpm seed`.
 *
 *   npx tsx prisma/seed-parking.ts
 */
import { prisma } from '../src/client';
import { anonCtx } from '../src/capabilities';
import { allocateEsoqoOrgHandle } from '../src/dal/payment-id';
import { createParkingLot, findParkingLot } from '../src/dal/parking';

const ctx = anonCtx();
const ORG_NAME = 'Demo Westlands Parking Ltd';
const TRADE_NAME = 'Westlands Parking';
const LOT_NAME = 'Demo Westlands Parking';

/** Where a driver would find the code: the tariff is public, and the
 *  grace period is the thing a driver asks about at the gate, so it is
 *  set to something they can be told out loud. The daily cap stops a
 *  forgotten car becoming an unbounded bill. */
const RATE = 50;
const GRACE = 10;
const MAX_PER_DAY = 400;

async function main() {
  let party = await prisma.party.findFirst({
    where: { organisation: { officialName: ORG_NAME } },
    select: { id: true, esoqoPaymentId: { select: { code: true, suspendedAt: true } } },
  });

  if (!party) {
    party = await prisma.party.create({
      data: {
        kind: 'ORGANISATION',
        county: '047',
        organisation: {
          create: { kind: 'BUSINESS', officialName: ORG_NAME, knownAs: TRADE_NAME, registrationNo: 'PWRK-DEMO-01' },
        },
      },
      select: { id: true, esoqoPaymentId: { select: { code: true, suspendedAt: true } } },
    });
    console.log(`created operator ${ORG_NAME}`);
  } else {
    console.log(`operator ${ORG_NAME} already exists`);
  }

  if (!party.esoqoPaymentId) {
    const code = await allocateEsoqoOrgHandle(party.id, ORG_NAME);
    console.log(`issued Esoqo Payment ID ${code}`);
  } else if (party.esoqoPaymentId.suspendedAt) {
    throw new Error('the demo operator’s Payment ID is suspended — parking cannot take money');
  } else {
    console.log(`operator already holds ${party.esoqoPaymentId.code}`);
  }

  const existing = await prisma.parkingLot.findFirst({
    where: { partyId: party.id, name: LOT_NAME },
    select: { code: true },
  });

  let code: string;
  if (existing) {
    code = existing.code;
    // Re-apply the tariff, so a rate changed in this file reaches a
    // database seeded before it. Lots already quoted keep the rate they
    // were quoted at — that snapshot is the whole point of the column.
    await prisma.parkingLot.update({
      where: { code: existing.code },
      data: { ratePerHourKes: RATE, graceMinutes: GRACE, maxPerDayKes: MAX_PER_DAY, active: true },
    });
    console.log(`reused lot ${existing.code}`);
  } else {
    const lot = await createParkingLot(ctx, {
      partyId: party.id,
      name: LOT_NAME,
      county: '047',
      address: 'Demo Ring Road Park, Westlands',
      ratePerHourKes: RATE,
      graceMinutes: GRACE,
      maxPerDayKes: MAX_PER_DAY,
    });
    code = lot.code;
    console.log(`created lot ${lot.code}`);
  }

  const check = await findParkingLot(code);
  if (!check) throw new Error('the lot did not resolve after seeding');
  if (!check.payable) throw new Error('the lot was seeded but cannot take payments');

  console.log(`
  Car park ready
  ─────────────────────────────────────────────
  Lot code   ${code}
  Tariff     KES ${check.ratePerHourKes}/hr, ${check.graceMinutes} min free, max KES ${check.maxPerDayKes}/day
  Payable    ${check.payable ? 'yes' : 'NO'}
  Check in   /pay/parking/${code}
`);
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
