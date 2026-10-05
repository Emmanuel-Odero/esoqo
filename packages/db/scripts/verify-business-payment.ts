/**
 * End-to-end check of dal/business-payment.ts against the real dev
 * database: lookup by every identifier, the refusals, the balanced
 * ledger entry, confirmation idempotency and the failure path.
 *
 * This package has no test runner, and the logic under test is almost
 * entirely Prisma filter composition — the kind of thing that typechecks
 * perfectly and returns the wrong rows. Hence a real database.
 *
 * It creates and destroys its own rows, sweeping anything a previous
 * aborted run left behind, so it is safe to re-run. Not for CI.
 *
 *   npx tsx scripts/verify-business-payment.ts
 */
import { prisma } from '../src/client';
import { anonCtx } from '../src/capabilities';
import {
  findPayableBusinesses, findPayableGroups, lookupPayee, lookupPayeeByPlate, createBusinessPayment,
  attachBusinessPaymentCheckoutRequestId, confirmBusinessPayment,
  failBusinessPayment, getBusinessPayment, BusinessPaymentError,
} from '../src/dal/business-payment';

const ctx = anonCtx();
const CODE = 'probstore482';
const OWNER_MSISDN = '+254712000001';
let pass = 0; let fail = 0;
const check = (label: string, ok: boolean, extra = '') => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${extra}`); }
};

async function sweep(prefixes: string[], names: string[]) {
  const parties = await prisma.party.findMany({
    where: { OR: [
      ...prefixes.map((p) => ({ esoqoPaymentId: { code: { startsWith: p } } })),
      ...names.map((n) => ({ organisation: { officialName: { startsWith: n } } })),
      ...names.map((n) => ({ person: { officialName: { startsWith: n } } })),
    ] },
    select: { id: true },
  });
  for (const { id } of parties) {
    await prisma.account.deleteMany({ where: { partyId: id } });
    await prisma.esoqoPaymentId.deleteMany({ where: { partyId: id } });
  }
  for (const p of prefixes) await prisma.esoqoPaymentId.deleteMany({ where: { code: { startsWith: p } } });
  await prisma.party.deleteMany({ where: { id: { in: parties.map((x) => x.id) } } });
}

async function main() {
  await sweep(['prob', 'dbg'], ['Probe ', 'Dbg ']);

  // ── fixture ──────────────────────────────────────────────────────────
  const org = await prisma.party.create({
    data: {
      kind: 'ORGANISATION', county: 'Nairobi',
      organisation: { create: { kind: 'BUSINESS', officialName: 'Probe Test Kitchen Ltd', knownAs: 'Probe Test Kitchen' } },
      esoqoPaymentId: { create: { code: CODE } },
    },
  });
  const owner = await prisma.party.create({
    data: {
      kind: 'PERSON', county: 'Nairobi',
      person: { create: { officialName: 'Probe Owner', msisdn: OWNER_MSISDN, email: 'probe.owner@example.com' } },
    },
  });
  // Explicit FK rather than a nested create: a membership must belong to
  // a person, and this is the only way to be sure it landed on ours.
  await prisma.membership.create({ data: { personId: owner.id, orgId: org.id, role: 'CHAIRPERSON' } });
  // A person who also holds a Payment ID — must NOT be payable.
  const personWithId = await prisma.party.create({
    data: {
      kind: 'PERSON', county: 'Nairobi',
      person: { create: { officialName: 'Probe Individual' } },
      esoqoPaymentId: { create: { code: 'probbundu482' } },
    },
  });
  // An org with no Payment ID — must NOT be payable.
  const orgNoId = await prisma.party.create({
    data: {
      kind: 'ORGANISATION', county: 'Nairobi',
      organisation: { create: { kind: 'BUSINESS', officialName: 'Probe Unregistered Duka' } },
    },
  });

  // ── number-plate and group fixtures ──────────────────────────────────
  // A plate is a *vehicle* credential, so the fixture has to run the whole
  // chain: a payable party, an enterprise, a ticket org, and a vehicle on
  // it. A verifier that only faked the last row would pass while the
  // joins underneath were wrong.
  const carrier = await prisma.party.create({
    data: {
      kind: 'ORGANISATION', county: 'Nairobi',
      organisation: { create: { kind: 'SUPPLIER', officialName: 'Probe Hauliers Ltd', knownAs: 'Probe Hauliers' } },
      esoqoPaymentId: { create: { code: 'probpilau482' } },
    },
  });
  const carrierEnt = await prisma.enterprise.create({
    data: { partyId: carrier.id, workRaw: 'transport', segment: 'transport' },
  });
  const carrierOrg = await prisma.ticketOrg.create({
    data: {
      enterpriseId: carrierEnt.id, name: 'Probe Hauliers Fleet', vertical: 'TRANSPORT',
      slug: `probe-hauliers-${Date.now()}`,
    },
  });
  await prisma.fleetVehicle.createMany({
    data: [
      { orgId: carrierOrg.id, plateNo: 'PRB 442Q' },
      { orgId: carrierOrg.id, plateNo: 'PRB443Q', label: 'same van, no space' },
      // Stored with a space and nowhere else. A variant generator that can
      // only ever *strip* separators never produces 'PRB 771C' from a
      // compact query, so this is the row that catches it — the two rows
      // above mask the bug between them.
      { orgId: carrierOrg.id, plateNo: 'PRB 771C' },
    ],
  });
  // A vehicle whose owner is not payable: the plate resolves, the
  // business does not, so the screen must say nothing found rather
  // than offer a person to pay.
  const personCarrier = await prisma.party.create({
    data: {
      kind: 'ORGANISATION', county: 'Nairobi',
      organisation: { create: { kind: 'BUSINESS', officialName: 'Probe Unlisted Ltd', knownAs: 'Probe Unlisted' } },
    },
  });
  const unlistedEnt = await prisma.enterprise.create({
    data: { partyId: personCarrier.id, workRaw: 'transport' },
  });
  const unlistedOrg = await prisma.ticketOrg.create({
    data: {
      enterpriseId: unlistedEnt.id, name: 'Probe Unlisted Fleet', vertical: 'TRANSPORT',
      slug: `probe-unlisted-${Date.now()}`,
    },
  });
  await prisma.fleetVehicle.create({ data: { orgId: unlistedOrg.id, plateNo: 'PRB 999X' } });

  // A group, for the group-only search. A CHAMA is the one kind whose
  // label is the whole point of the page, so it is the one worth pinning.
  const chama = await prisma.party.create({
    data: {
      kind: 'ORGANISATION', county: 'Nairobi',
      organisation: { create: { kind: 'CHAMA', officialName: 'Probe Sunrise Chama', knownAs: 'Probe Sunrise' } },
      esoqoPaymentId: { create: { code: 'probgroup482' } },
    },
  });

  try {
    console.log('\n== lookup ==');
    for (const [label, ident] of [
      ['by Esoqo ID (current shape)', CODE],
      ['by Esoqo ID (lower case)', CODE.toLowerCase()],
      ['by pay link', `https://esoqo.co.ke/pay?to=${CODE}&amount=500`],
      ['by owner phone (local form)', '0712000001'],
      ['by owner phone (E.164)', OWNER_MSISDN],
      ['by owner email', 'probe.owner@example.com'],
      ['by trading name', 'Probe Test'],
      ['by registered name', 'Kitchen Ltd'],
    ] as const) {
      const rows = await findPayableBusinesses(ctx, ident);
      check(`${label} -> 1 payable`, rows.length === 1 && rows[0]?.partyId === org.id, JSON.stringify(rows));
    }
    const found = await findPayableBusinesses(ctx, CODE);
    const first = found[0];
    check('projection carries the issued code', first?.esoqoId === CODE);
    check('projection uses the trading name', first?.name === 'Probe Test Kitchen');
    check('projection leaks no phone/email',
      first !== undefined && !('phone' in first) && !('email' in first) && !('msisdn' in first));

    console.log('\n== refusals ==');
    check('empty identifier -> EMPTY', (await lookupPayee(ctx, '   ')).status === 'EMPTY');
    check('nonsense -> NOT_FOUND', (await lookupPayee(ctx, 'zzzz-nothing-here')).status === 'NOT_FOUND');
    const personIdLookup = await lookupPayee(ctx, 'probbundu482');
    check("a person's own ID -> NOT_PAYABLE", personIdLookup.status === 'NOT_PAYABLE', `got ${personIdLookup.status}`);
    check('an org with no ID is not payable by name',
      (await findPayableBusinesses(ctx, 'Probe Unregistered Duka')).length === 0);
    check('a PENDING invitee is not a member yet', await (async () => {
      const invitee = await prisma.party.create({
        data: { kind: 'PERSON', county: 'Nairobi', person: { create: { officialName: 'Probe Invitee', msisdn: '+254712000009' } } },
      });
      await prisma.membership.create({ data: { personId: invitee.id, orgId: org.id, status: 'PENDING' } });
      const n = (await findPayableBusinesses(ctx, '+254712000009')).length;
      await prisma.party.delete({ where: { id: invitee.id } });
      return n === 0;
    })());
    check('suspended ID is not payable', await (async () => {
      await prisma.esoqoPaymentId.update({ where: { partyId: org.id }, data: { suspendedAt: new Date() } });
      const n = (await findPayableBusinesses(ctx, CODE)).length;
      await prisma.esoqoPaymentId.update({ where: { partyId: org.id }, data: { suspendedAt: null } });
      return n === 0;
    })());
    check('soft-deleted org is not payable', await (async () => {
      await prisma.party.update({ where: { id: org.id }, data: { deletedAt: new Date() } });
      const n = (await findPayableBusinesses(ctx, CODE)).length;
      await prisma.party.update({ where: { id: org.id }, data: { deletedAt: null } });
      return n === 0;
    })());

    console.log('\n== create ==');
    const payment = await createBusinessPayment(ctx, {
      payeePartyId: org.id, amountKes: 750, payerMsisdn: '0712000002',
      payerName: 'Jane Wanjiku', payerEsoqoId: 'esk-prbnd2-ke',
      note: 'Lunch', 
    });
    check('starts PENDING', payment.status === 'PENDING');
    check('normalises the payer number', payment.payerMsisdn === '+254712000002');
    check('snapshots the payee code', payment.payeeEsoqoId === CODE);
    check('snapshots the payee name', payment.payeeName === 'Probe Test Kitchen');
    check('normalises the payer Esoqo ID', payment.payerEsoqoId === 'probbundu482');

    for (const [label, input, code] of [
      ['zero amount', { amountKes: 0 }, 'AMOUNT_INVALID'],
      ['negative amount', { amountKes: -5 }, 'AMOUNT_INVALID'],
      ['NaN amount', { amountKes: Number.NaN }, 'AMOUNT_INVALID'],
      ['huge amount', { amountKes: 9_999_999 }, 'AMOUNT_INVALID'],
      ['bad phone', { amountKes: 100, payerMsisdn: '12345' }, 'INVALID_MSISDN'],
      ['unpayable payee', { amountKes: 100, payerMsisdn: '+254712000002', payeePartyId: orgNoId.id }, 'NOT_PAYABLE'],
    ] as const) {
      const err = await createBusinessPayment(ctx, { payerMsisdn: '+254712000002', ...(input as object) } as never)
        .then(() => null, (e: unknown) => e);
      check(`rejects ${label}`, err instanceof BusinessPaymentError && err.code === code,
        err instanceof BusinessPaymentError ? err.code : String(err));
    }

    console.log('\n== confirm + ledger ==');
    const checkoutId = `probe-checkout-${Date.now()}`;
    await attachBusinessPaymentCheckoutRequestId(payment.id, checkoutId);
    const entry = await prisma.journalEntry.findUnique({ where: { idempotencyKey: checkoutId } });
    check('nothing posted before confirmation', entry === null);

    const confirmed = await confirmBusinessPayment(checkoutId, 'QJG1234XYZ');
    check('CONFIRMED', confirmed.payment.status === 'CONFIRMED');
    check('confirmedAt stamped', confirmed.payment.confirmedAt !== null);
    check('mpesa receipt stored', confirmed.payment.mpesaReceiptCode === 'QJG1234XYZ');
    check('esoqo receipt code minted', /^BP-[0-9A-F]{10}$/.test(confirmed.payment.receiptCode ?? ''));
    check('justConfirmed true', confirmed.justConfirmed);
    check('notify has payer', confirmed.notify?.payerMsisdn === '+254712000002');
    check('notify has the business owner', confirmed.notify?.businessMsisdns.includes(OWNER_MSISDN) === true, JSON.stringify(confirmed.notify));

    const je = await prisma.journalEntry.findUnique({
      where: { idempotencyKey: checkoutId },
      include: { postings: { include: { account: true } } },
    });
    const sum = (je?.postings ?? []).reduce((s, p) => s + Number(p.amount), 0);
    check('journal entry exists', je !== null);
    check('entry is balanced', sum === 0, `sum=${sum}`);
    check('credits BUSINESS_REVENUE for the payee', je?.postings.some(
      (p) => p.account.kind === 'BUSINESS_REVENUE' && p.account.partyId === org.id && Number(p.amount) === 750) === true);
    check('debits SETTLEMENT', je?.postings.some(
      (p) => p.account.kind === 'SETTLEMENT' && p.account.partyId === null && Number(p.amount) === -750) === true);
    check('entry reference is unique-shaped', je?.reference === `BUSINESS-PAYMENT-${payment.id}`);

    console.log('\n== idempotency ==');
    const replay = await confirmBusinessPayment(checkoutId, 'QJG1234XYZ');
    check('replay is a no-op', replay.justConfirmed === false);
    check('replay keeps the same receipt', replay.payment.receiptCode === confirmed.payment.receiptCode);
    const entries = await prisma.journalEntry.count({ where: { idempotencyKey: checkoutId } });
    check('replay posts no second entry', entries === 1);
    const unknown = await confirmBusinessPayment('no-such-checkout-id', 'X').then(() => null, (e: unknown) => e);
    check('unknown checkout -> NOT_FOUND', unknown instanceof BusinessPaymentError && unknown.code === 'NOT_FOUND');

    console.log('\n== failure ==');
    const doomed = await createBusinessPayment(ctx, { payeePartyId: org.id, amountKes: 100, payerMsisdn: '+254712000003' });
    const doomedCheckout = `probe-doomed-${Date.now()}`;
    await attachBusinessPaymentCheckoutRequestId(doomed.id, doomedCheckout);
    const failed = await failBusinessPayment(doomedCheckout, 'Request cancelled by user');
    check('FAILED', failed.status === 'FAILED');
    check('reason kept', failed.failureReason === 'Request cancelled by user');
    const replayFail = await failBusinessPayment(doomedCheckout, 'again');
    check('failure replay is a no-op', replayFail.status === 'FAILED' && replayFail.failureReason === 'Request cancelled by user');
    check('no ledger entry for a failed payment',
      (await prisma.journalEntry.count({ where: { idempotencyKey: doomedCheckout } })) === 0);

    console.log('\n== payer-visible read ==');
    const mine = await getBusinessPayment(payment.id);
    check('found by id', mine?.id === payment.id);
    check('carries the payer number', mine?.payerMsisdn === '+254712000002');
    check('carries no payee contact field', !('payeePhone' in (mine ?? {})));
    check('unknown id is null', (await getBusinessPayment('00000000-0000-0000-0000-000000000000')) === null);

    console.log('\n== number plate ==');

    const plateHit = await lookupPayeeByPlate('prb 442q');
    const plateFound = plateHit.status === 'FOUND' ? plateHit.businesses : [];
    check('plate found case- and space-insensitively',
      plateFound.some((b) => b.partyId === carrier.id), JSON.stringify(plateHit));
    // Both directions of the separator, against a row stored one way only.
    const compactOnly = await lookupPayeeByPlate('PRB771C');
    check('a compact query finds a plate stored with a space',
      compactOnly.status === 'FOUND' && compactOnly.businesses.some((b) => b.partyId === carrier.id),
      JSON.stringify(compactOnly));
    const spacedOnly = await lookupPayeeByPlate('PRB-771C');
    check('a hyphenated query finds a plate stored with a space',
      spacedOnly.status === 'FOUND' && spacedOnly.businesses.some((b) => b.partyId === carrier.id));
    const plateDashed = await lookupPayeeByPlate('PRB-442Q');
    check('hyphen form of a plate resolves too',
      plateDashed.status === 'FOUND' && plateDashed.businesses.some((b) => b.partyId === carrier.id));
    check('both spellings of one van give one payee, not two',
      plateFound.length === 1, JSON.stringify(JSON.stringify(plateFound.map((b) => `${b.esoqoId}:${b.name}`))));
    check('payable kind only — a plain business plate is not a payee',
      (await lookupPayeeByPlate('PRB 999X')).status === 'NOT_FOUND');
    check('unknown plate -> NOT_FOUND', (await lookupPayeeByPlate('ZZZ 000Z')).status === 'NOT_FOUND');
    check('too short to be a plate -> NOT_FOUND', (await lookupPayeeByPlate('K')).status === 'NOT_FOUND');

    // ── group-only search ───────────────────────────────────────────────
    console.log('\n== group search ==');
    const groups = await findPayableGroups(ctx, 'Probe Sunrise');
    check('a chama is found as a group', groups.some((g) => g.partyId === chama.id), JSON.stringify(groups.map((g) => g.partyId)));
    check('the group comes back with its kind, for the label',
      groups.find((g) => g.partyId === chama.id)?.kind === 'CHAMA');
    // The existing probe kitchen is a BUSINESS: a business search must not
    // leak onto /pay/group, or the page offers a company under a heading
    // that promises savings groups.
    check('a business is filtered out of a group search',
      !(await findPayableGroups(ctx, 'Probe Test Kitchen')).some((g) => g.partyId === org.id));
    check('group search respects the cap',
      (await findPayableGroups(ctx, 'Probe', 1)).length <= 1);
  } finally {
    // ── cleanup ────────────────────────────────────────────────────────
    for (const p of await prisma.businessPayment.findMany({ where: { payeePartyId: { in: [org.id, orgNoId.id] } }, select: { id: true } })) {
      const row = await prisma.businessPayment.findUnique({ where: { id: p.id } });
      if (row?.journalEntryId) await prisma.journalEntry.delete({ where: { id: row.journalEntryId } }).catch(() => {});
      await prisma.businessPayment.delete({ where: { id: p.id } }).catch(() => {});
    }
    // TicketOrg/Enterprise/FleetVehicle cascade from the party, so the
    // vehicle fixtures go with it — but the unlisted org has no payment
    // rows and must still be swept.
    for (const id of [org.id, owner.id, personWithId.id, orgNoId.id, carrier.id, personCarrier.id, chama.id]) {
      await prisma.account.deleteMany({ where: { partyId: id } });
      await prisma.membership.deleteMany({ where: { personId: id } });
      await prisma.esoqoPaymentId.deleteMany({ where: { partyId: id } });
      await prisma.organisation.deleteMany({ where: { partyId: id } });
      await prisma.person.deleteMany({ where: { partyId: id } });
      await prisma.party.delete({ where: { id } }).catch(() => {});
    }
    console.log(`\n${pass} passed, ${fail} failed\n`);
  }
  if (fail > 0) process.exitCode = 1;
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
