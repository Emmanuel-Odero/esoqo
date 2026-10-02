/**
 * Runtime check of dal/parking.ts against the real dev database: the
 * pricing arithmetic, the refusals, idempotent checkout, the link from a
 * quoted session to a paid one, and the guarantee that a parking charge
 * can only ever be created for the lot that quoted it.
 *
 * Same reason as verify-business-payment.ts: this package has no test
 * runner and most of what matters here is Prisma filter composition,
 * which typechecks perfectly and returns the wrong rows. The pricing
 * arithmetic is here too, because fifty shillings is a small bug that
 * becomes an argument at a barrier.
 *
 * Creates and destroys its own rows, sweeping anything an aborted run
 * left behind. Not for CI.
 *
 *   npx tsx scripts/verify-parking.ts
 */
import { prisma } from '../src/client';
import { anonCtx } from '../src/capabilities';
import {
  createParkingLot, findParkingLot, checkInParking, getParkingSession,
  quoteParkingCheckout, quoteParkingStay, listUnpaidParkingSessions,
  voidParkingSession, ParkingError,
} from '../src/dal/parking';
import {
  createBusinessPayment, attachBusinessPaymentCheckoutRequestId,
  confirmBusinessPayment, BusinessPaymentError,
} from '../src/dal/business-payment';

const ctx = anonCtx();
const MSISDN = '+254712000003';
const RATE = 50;
const GRACE = 10;
const MIN = 60_000;
let pass = 0; let fail = 0;
const check = (label: string, ok: boolean, extra = '') => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${extra}`); }
};
/** A thrown code, or a sentinel if nothing was thrown. */
async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return 'NO_THROW'; } catch (e) {
    return e instanceof ParkingError ? e.code : e instanceof BusinessPaymentError ? e.code : 'OTHER';
  }
}
const sweepable = { officialName: { startsWith: 'Probe Parking' } };

async function sweep() {
  const parties = await prisma.party.findMany({ where: { organisation: sweepable }, select: { id: true } });
  for (const { id } of parties) {
    const sessions = await prisma.parkingSession.findMany({ where: { lot: { partyId: id } }, select: { id: true } });
    for (const s of sessions) {
      for (const p of await prisma.businessPayment.findMany({ where: { parkingSessionId: s.id }, select: { id: true } })) {
        const row = await prisma.businessPayment.findUnique({ where: { id: p.id } });
        if (row?.journalEntryId) await prisma.journalEntry.delete({ where: { id: row.journalEntryId } }).catch(() => {});
        await prisma.businessPayment.delete({ where: { id: p.id } }).catch(() => {});
      }
      await prisma.parkingSession.delete({ where: { id: s.id } }).catch(() => {});
    }
    await prisma.parkingLot.deleteMany({ where: { partyId: id } });
    await prisma.account.deleteMany({ where: { partyId: id } });
    await prisma.esoqoPaymentId.deleteMany({ where: { partyId: id } });
  }
  await prisma.esoqoPaymentId.deleteMany({ where: { code: { startsWith: 'prbprk' } } });
  await prisma.party.deleteMany({ where: { id: { in: parties.map((p) => p.id) } } });
}

async function main() {
  await sweep();

  // ── the pricing arithmetic ───────────────────────────────────────────
  // Pure, so it is checked first and in full: every one of these is a
  // stay somebody actually had, and each has one right answer.
  console.log('\n== pricing ==');
  const q = (elapsedMin: number, over: Partial<Parameters<typeof quoteParkingStay>[0]> = {}) =>
    quoteParkingStay({ elapsedMs: elapsedMin * MIN, ratePerHourKes: RATE, graceMinutes: GRACE, ...over });

  check('still inside the grace period is free', q(9).amountKes === 0, String(q(9).amountKes));
  check('the grace minute itself is still free', q(GRACE).amountKes === 0, String(q(GRACE).amountKes));
  check('one minute past grace is a whole hour', q(GRACE + 1).amountKes === RATE, String(q(GRACE + 1).amountKes));
  check('grace comes off the front, not off every hour', q(GRACE + 61).amountKes === 2 * RATE, String(q(GRACE + 61).amountKes));
  check('elapsed is floored, not rounded up', q(9.98).amountKes === 0, String(q(9.98).amountKes));
  check('34 minutes past grace is one hour, not two', q(GRACE + 34).amountKes === RATE, String(q(GRACE + 34).amountKes));
  check('one minute into the second hour is two', q(GRACE + 61).amountKes === 2 * RATE);
  check('billed minutes exclude the grace', q(GRACE + 34).billedMinutes === 34, String(q(GRACE + 34).billedMinutes));
  check('zero grace bills from the first minute', q(1, { graceMinutes: 0 }).amountKes === RATE, String(q(1, { graceMinutes: 0 }).amountKes));
  check('a negative clock cannot produce a negative bill', quoteParkingStay({ elapsedMs: -5 * MIN, ratePerHourKes: RATE, graceMinutes: 0 }).amountKes === 0);
  check('zero elapsed is free', q(0).amountKes === 0);

  // The cap is the other rule a car park actually runs, and a day is
  // counted from arrival, not from midnight — otherwise a car parked at
  // 23:00 gets the cap twice in two hours.
  const capped = quoteParkingStay({ elapsedMs: 30 * 60 * MIN, ratePerHourKes: RATE, graceMinutes: GRACE, maxPerDayKes: 300 });
  check('a long stay is capped at the daily rate', capped.amountKes === 300, String(capped.amountKes));
  check('the cap reports itself so the quote can say why', capped.capped === true);
  check('a stay under the cap does not report itself as capped',
    quoteParkingStay({ elapsedMs: 2 * 60 * MIN, ratePerHourKes: RATE, graceMinutes: GRACE, maxPerDayKes: 300 }).capped === false);
  check('a lot with no cap is not capped', quoteParkingStay({ elapsedMs: 900 * 60 * MIN, ratePerHourKes: RATE, graceMinutes: GRACE }).capped === false);
  check('a zero cap is not a free car park', quoteParkingStay({ elapsedMs: 60 * MIN, ratePerHourKes: RATE, graceMinutes: 0, maxPerDayKes: 0 }).amountKes === RATE);

  // ── fixture ──────────────────────────────────────────────────────────
  console.log('\n== fixture ==');
  const org = await prisma.party.create({
    data: {
      kind: 'ORGANISATION', county: 'Nairobi',
      organisation: { create: { kind: 'BUSINESS', officialName: 'Probe Parking Lots Ltd', knownAs: 'Probe Parking' } },
      esoqoPaymentId: { create: { code: 'prbprk1482' } },
    },
  });
  // A second operator, for the "the lot must be the payee" check.
  const other = await prisma.party.create({
    data: {
      kind: 'ORGANISATION', county: 'Nairobi',
      organisation: { create: { kind: 'BUSINESS', officialName: 'Probe Parking Other Ltd' } },
      esoqoPaymentId: { create: { code: 'prbprk2482' } },
    },
  });

  const lot = await createParkingLot(ctx, {
    partyId: org.id, name: 'Probe Westlands Parking', county: 'Nairobi',
    address: 'Probe Ring Road', ratePerHourKes: RATE, graceMinutes: GRACE, maxPerDayKes: 300,
  });
  check('a lot gets a code in the PRK shape', /^PRK-[A-Z2-9]{4}-[A-Z2-9]{2}$/.test(lot.code), lot.code);
  check('a rate below one shilling an hour is refused', await codeOf(() => createParkingLot(ctx, {
    partyId: org.id, name: 'Probe Bad Lot', ratePerHourKes: 0,
  })) === 'LOT_CLOSED');

  // ── lot lookup ───────────────────────────────────────────────────────
  console.log('\n== lot lookup ==');
  const found = await findParkingLot(lot.code);
  check('found by its printed code', found?.code === lot.code);
  check('carries the driver-facing rate', found?.ratePerHourKes === RATE);
  check('is payable, because the operator has a live Payment ID', found?.payable === true);
  check('found from a full scanned URL', (await findParkingLot(`https://esoqo.co.ke/pay/parking/${lot.code}`))?.code === lot.code);
  check('found in lower case', (await findParkingLot(lot.code.toLowerCase()))?.code === lot.code);
  check('found with a query string on the QR', (await findParkingLot(`${lot.code}?utm=qr`))?.code === lot.code);
  check('an unknown lot is null, not a throw', (await findParkingLot('PRK-0000-00')) === null);
  check('a business ID is not a lot', (await findParkingLot('probhwqhdu482')) === null);
  check('nonsense is null', (await findParkingLot('hello')) === null);

  // A lot whose operator has lost its Payment ID must not read as
  // payable: a rate the lot cannot honour is worse than no rate.
  const orphan = await prisma.party.create({
    data: {
      kind: 'ORGANISATION', county: 'Nairobi',
      organisation: { create: { kind: 'BUSINESS', officialName: 'Probe Parking Orphan Ltd' } },
    },
  });
  const orphanLot = await createParkingLot(ctx, { partyId: orphan.id, name: 'Probe Orphan Lot', ratePerHourKes: RATE });
  check('a lot with no Payment ID is not payable', (await findParkingLot(orphanLot.code))?.payable === false);

  // ── check in ─────────────────────────────────────────────────────────
  console.log('\n== check in ==');
  const badLot = await codeOf(() => checkInParking(ctx, { lotCode: 'PRK-0000-00', msisdn: MSISDN }));
  check('an unknown lot is refused', badLot === 'LOT_NOT_FOUND', badLot);
  const badMsisdn = await codeOf(() => checkInParking(ctx, { lotCode: lot.code, msisdn: '12345' }));
  check('a number that is not a mobile is refused', badMsisdn === 'INVALID_MSISDN', badMsisdn);
  const badCode = await codeOf(() => checkInParking(ctx, { lotCode: 'nonsense', msisdn: MSISDN }));
  check('a bad lot code is refused', badCode === 'LOT_NOT_FOUND', badCode);

  const s1 = await checkInParking(ctx, { lotCode: lot.code, msisdn: MSISDN, plateNo: 'kcb 123a' });
  check('the ticket is in the PRT shape', /^PRT-[A-Z2-9]{4}-[A-Z2-9]{2}$/.test(s1.ticketCode), s1.ticketCode);
  check('the stay starts open', s1.status === 'OPEN');
  check('the plate is upper-cased for a driver to read back', s1.plateNo === 'KCB 123A', String(s1.plateNo));
  check('the rate is snapshotted onto the stay', s1.ratePerHourKes === RATE);
  check('the grace period is snapshotted too', s1.graceMinutes === GRACE);
  check('nothing is billed before checkout', s1.amountKes === null);
  check('the view carries the lot name', s1.lotName === 'Probe Westlands Parking');
  check('the view leaks no owner phone number', !('msisdn' in (s1 as object)), JSON.stringify(Object.keys(s1)));

  // Distinct tickets across a burst, because two cars under one code
  // would silently pay off each other's stay.
  const burst = await Promise.all(
    Array.from({ length: 12 }, () => checkInParking(ctx, { lotCode: lot.code, msisdn: MSISDN })),
  );
  check('twelve cars get twelve different tickets', new Set(burst.map((s) => s.ticketCode)).size === 12);
  const overCap = await codeOf(() => checkInParking(ctx, { lotCode: lot.code, msisdn: MSISDN }));
  check('the same number cannot hold a sixth open ticket', overCap === 'ALREADY_CHECKED_OUT', overCap);
  check('the cap is per number, so another number is unaffected',
    (await checkInParking(ctx, { lotCode: lot.code, msisdn: '+254712000004' })).status === 'OPEN');

  // ── ticket lookup ────────────────────────────────────────────────────
  console.log('\n== ticket lookup ==');
  check('found by ticket', (await getParkingSession(s1.ticketCode))?.ticketCode === s1.ticketCode);
  check('found in lower case', (await getParkingSession(s1.ticketCode.toLowerCase()))?.ticketCode === s1.ticketCode);
  check('found from a full URL', (await getParkingSession(`https://esoqo.co.ke/pay/parking/${s1.ticketCode}`))?.ticketCode === s1.ticketCode);
  check('an unknown ticket is null', (await getParkingSession('PRT-0000-00')) === null);
  check('a lot code is not a ticket', (await getParkingSession(lot.code)) === null,
    'a PRK code must not check a car out');

  // ── checkout, and the freeze ─────────────────────────────────────────
  console.log('\n== checkout ==');
  const at = (n: number) => new Date(s1.checkedInAt ? Date.parse(s1.checkedInAt) : Date.now() + n * MIN);
  const early = await quoteParkingCheckout(ctx, s1.ticketCode, at(GRACE + 34));
  check('a stay inside grace is quoted at zero', early.amountKes === 0, String(early.amountKes));
  check('and the stay is now closed', early.status === 'QUOTED');
  check('checkout time is recorded', early.checkedOutAt !== null);

  // This is the one that matters: quote it again an hour later and the
  // price must not move. A driver who taps twice does not get billed
  // for the time they spent tapping.
  const again = await quoteParkingCheckout(ctx, s1.ticketCode, at(GRACE + 34 + 600));
  check('quoting twice does not move the price', again.amountKes === early.amountKes, `${early.amountKes} -> ${again.amountKes}`);
  check('quoting twice does not move the checkout time', again.checkedOutAt === early.checkedOutAt);

  const s2 = await checkInParking(ctx, { lotCode: lot.code, msisdn: '+254712000005' });
  const s2Start = Date.parse(s2.checkedInAt);
  const long = await quoteParkingCheckout(ctx, s2.ticketCode, new Date(s2Start + (30 * 60) * MIN));
  check('a long stay hits the daily cap', long.amountKes === 300, String(long.amountKes));
  check('and reports why', long.hours !== null && long.hours * RATE > 300);
  const badTicket = await codeOf(() => quoteParkingCheckout(ctx, 'PRT-0000-00'));
  check('checking out an unknown ticket is refused', badTicket === 'TICKET_NOT_FOUND', badTicket);

  const s3 = await checkInParking(ctx, { lotCode: lot.code, msisdn: '+254712000006' });
  await voidParkingSession(ctx, s3.ticketCode, 'Probe: blocked bay');
  check('a voided ticket is not payable', (await getParkingSession(s3.ticketCode))?.status === 'VOIDED');
  check('checking out a voided ticket is refused',
    await codeOf(() => quoteParkingCheckout(ctx, s3.ticketCode)) === 'NOT_QUOTED');

  // ── the money path ───────────────────────────────────────────────────
  console.log('\n== payment ==');
  const s4 = await checkInParking(ctx, { lotCode: lot.code, msisdn: '+254712000007' });
  const s4Start = Date.parse(s4.checkedInAt);
  const quoted = await quoteParkingCheckout(ctx, s4.ticketCode, new Date(s4Start + 3 * 60 * MIN));
  // 3h parked less 10 free minutes is 2h50m, which is three commenced
  // hours. Prorating this to 2 would pay the lot less for a car that was
  // genuinely in the bay for nearly three hours.
  check('three hours less the grace is three commenced hours', quoted.amountKes === 3 * RATE, String(quoted.amountKes));
  const s4Id = (await prisma.parkingSession.findUnique({ where: { ticketCode: s4.ticketCode }, select: { id: true } }))!.id;

  // An unpaid quoted stay is the operator's problem to chase, so it has
  // to be findable — checked before the payment exists, and checked again
  // after, or this proves nothing about either state.
  const chasedBefore = await listUnpaidParkingSessions(lot.code);
  check('a quoted, unpaid stay shows on the chase list', chasedBefore.some((u) => u.ticketCode === s4.ticketCode));
  check('an open stay is not chased, it has not left yet', !chasedBefore.some((u) => u.ticketCode === burst[0]!.ticketCode));

  // A free stay cannot be turned into a payment at all, and the charge
  // cannot be any number other than the quote. Both are the same rule.
  check('a quoted stay always carries an amount', quoted.amountKes !== null);
  const quotedKes = quoted.amountKes ?? 0;

  // A free stay cannot be turned into a payment at all, and the charge
  // cannot be any number other than the quote. Both are the same rule.
  const freeId = (await prisma.parkingSession.findUnique({ where: { ticketCode: s1.ticketCode }, select: { id: true } }))!.id;
  check('a zero quote is refused as a payment',
    await codeOf(() => createBusinessPayment(ctx, {
      payeePartyId: org.id, amountKes: 1, payerMsisdn: MSISDN, parkingSessionId: freeId,
    })) === 'AMOUNT_INVALID');
  check('an amount above the quote is refused',
    await codeOf(() => createBusinessPayment(ctx, {
      payeePartyId: org.id, amountKes: quotedKes + 50, payerMsisdn: MSISDN, parkingSessionId: s4Id,
    })) === 'AMOUNT_INVALID');
  check('an amount below the quote is refused too',
    await codeOf(() => createBusinessPayment(ctx, {
      payeePartyId: org.id, amountKes: quotedKes - 50, payerMsisdn: MSISDN, parkingSessionId: s4Id,
    })) === 'AMOUNT_INVALID');
  check('a ticket from another lot is refused',
    await codeOf(() => createBusinessPayment(ctx, {
      payeePartyId: other.id, amountKes: quotedKes, payerMsisdn: MSISDN, parkingSessionId: s4Id,
    })) === 'NOT_PAYABLE');
  check('an unknown ticket is refused',
    await codeOf(() => createBusinessPayment(ctx, {
      payeePartyId: org.id, amountKes: quotedKes, payerMsisdn: MSISDN,
      parkingSessionId: '00000000-0000-0000-0000-000000000000',
    })) === 'NOT_FOUND');
  const noneLeft = await prisma.businessPayment.count({ where: { parkingSessionId: s4Id } });
  check('no payment row survives a refused one', noneLeft === 0, String(noneLeft));

  // The happy path: exact quoted amount, to the lot's own operator.
  const payment = await createBusinessPayment(ctx, {
    payeePartyId: org.id, amountKes: quotedKes, payerMsisdn: MSISDN, parkingSessionId: s4Id,
  });
  check('the payment is linked to the ticket', payment.parkingSessionId === s4Id);
  check('the payee is the lot, not a person', payment.payeeName === 'Probe Parking', payment.payeeName);
  check('the stay is still not paid until money moves',
    (await getParkingSession(s4.ticketCode))?.status === 'QUOTED');
  check('a stay with a payment on it leaves the chase list',
    !(await listUnpaidParkingSessions(lot.code)).some((u) => u.ticketCode === s4.ticketCode));

  const checkoutId = 'ws_CO_PROBE_PARKING';
  await attachBusinessPaymentCheckoutRequestId(payment.id, checkoutId);
  const result = await confirmBusinessPayment(checkoutId, 'QJG_PROBE_PARKING');
  check('the payment confirms', result.payment.status === 'CONFIRMED');
  const paid = await getParkingSession(s4.ticketCode);
  check('confirmation settles the stay', paid?.status === 'PAID', String(paid?.status));
  check('the stay carries a receipt', Boolean(paid?.receiptCode));
  check('a settled stay leaves the chase list',
    !(await listUnpaidParkingSessions(lot.code)).some((u) => u.ticketCode === s4.ticketCode));

  // Confirming twice must not double-post, and must not be a second
  // chance to move the session.
  const again2 = await confirmBusinessPayment(checkoutId, 'QJG_PROBE_PARKING');
  check('confirming twice is idempotent', again2.payment.status === 'CONFIRMED');
  check('confirming twice leaves one journal entry',
    (await prisma.journalEntry.count({ where: { businessPayment: { id: payment.id } } })) === 1);
  check('confirming twice leaves the stay paid', (await getParkingSession(s4.ticketCode))?.status === 'PAID');

  // A zero stay is a real outcome — inside the grace period — and the
  // page has to be able to say so without a payment existing.
  check('a free stay stays quoted, not paid, and owes nothing',
    (await getParkingSession(s1.ticketCode))?.amountKes === 0);

  // ── cleanup ──────────────────────────────────────────────────────────
  console.log('\n== cleanup ==');
  for (const p of await prisma.businessPayment.findMany({
    where: { payeePartyId: { in: [org.id, other.id] } }, select: { id: true },
  })) {
    const row = await prisma.businessPayment.findUnique({ where: { id: p.id } });
    if (row?.journalEntryId) await prisma.journalEntry.delete({ where: { id: row.journalEntryId } }).catch(() => {});
    await prisma.businessPayment.delete({ where: { id: p.id } }).catch(() => {});
  }
  for (const partyId of [org.id, other.id, orphan.id]) {
    await prisma.parkingSession.deleteMany({ where: { lot: { partyId } } });
    await prisma.parkingLot.deleteMany({ where: { partyId } });
  }
  for (const id of [org.id, other.id, orphan.id]) {
    await prisma.account.deleteMany({ where: { partyId: id } });
    await prisma.esoqoPaymentId.deleteMany({ where: { partyId: id } });
    await prisma.organisation.deleteMany({ where: { partyId: id } });
    await prisma.party.delete({ where: { id } }).catch(() => {});
  }
  await sweep();
  // Scoped to this file's own fixture, not a global count. A seeded car
  // park legitimately has sessions parked in it — an E2E run, a demo —
  // and "the table is empty" is not a property of correct cleanup, it is
  // a property of an empty database. What must be true is that this
  // verifier left nothing of its own behind.
  const sessions = await prisma.parkingSession.count({ where: { lot: { partyId: { in: [org.id, other.id, orphan.id] } } } });
  check('no parking sessions of its own left behind', sessions === 0, String(sessions));
  const lots = await prisma.parkingLot.count({ where: { party: { organisation: { officialName: { startsWith: 'Probe' } } } } });
  check('no parking lots of its own left behind', lots === 0, String(lots));
  const probes = await prisma.party.count({ where: { organisation: sweepable } });
  check('no probe parties left behind', probes === 0, String(probes));
  check('no journal entries orphaned by the sweep',
    (await prisma.journalEntry.count({ where: { businessPayment: null, description: { contains: 'Probe' } } })) === 0);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
