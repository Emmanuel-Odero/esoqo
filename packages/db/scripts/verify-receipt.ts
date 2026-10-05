/**
 * End-to-end check of dal/receipt.ts (and the pieces of dal/reference.ts
 * it feeds) against the real dev database: issuing a receipt for both a
 * store-attributed and a storeless source, the shopkeeper's "Needs
 * items" list, addReceiptItems's exact-amount and one-shot rules, that
 * itemization never touches the ledger, and the public verify lookup.
 *
 * Same reasoning as verify-business-payment.ts: this package has no
 * test runner, and the logic under test is Prisma filter composition
 * and arithmetic — the kind of thing that typechecks fine and returns
 * the wrong rows. Hence a real database.
 *
 * It creates and destroys its own rows, sweeping anything a previous
 * aborted run left behind, so it is safe to re-run. Not for CI.
 *
 *   npx tsx scripts/verify-receipt.ts
 */
import { prisma } from '../src/client';
import { anonCtx, ROLE_PRESETS, type Ctx } from '../src/capabilities';
import { isTransactionCodeValid } from '@esoqo/domain';
import {
  issueReceiptFor, issueReceipt, listReceiptsNeedingItems, addReceiptItems, getReceipt, ReceiptError,
} from '../src/dal/receipt';
import { verifyReceipt } from '../src/dal/reference';

let pass = 0; let fail = 0;
const check = (label: string, ok: boolean, extra = '') => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${extra}`); }
};

async function sweep() {
  const stores = await prisma.store.findMany({ where: { slug: { startsWith: 'probe-receipt' } }, select: { id: true, enterpriseId: true } });
  for (const s of stores) {
    await prisma.receiptItem.deleteMany({ where: { receipt: { storeId: s.id } } });
    await prisma.receipt.deleteMany({ where: { storeId: s.id } });
    await prisma.posSale.deleteMany({ where: { storeId: s.id } });
    await prisma.product.deleteMany({ where: { storeId: s.id } });
  }
  await prisma.store.deleteMany({ where: { slug: { startsWith: 'probe-receipt' } } });
  const parties = await prisma.party.findMany({ where: { organisation: { officialName: { startsWith: 'Probe Receipt' } } }, select: { id: true } });
  for (const { id } of parties) {
    await prisma.businessPayment.deleteMany({ where: { payeePartyId: id } });
    await prisma.enterprise.deleteMany({ where: { partyId: id } });
  }
  await prisma.party.deleteMany({ where: { organisation: { officialName: { startsWith: 'Probe Receipt' } } } });
}

async function main() {
  await sweep();

  // ── fixture: a store, an owner ctx, two products ────────────────────
  const owner = await prisma.party.create({
    data: {
      kind: 'ORGANISATION', county: 'Nairobi',
      organisation: { create: { kind: 'BUSINESS', officialName: 'Probe Receipt Kitchen Ltd', knownAs: 'Probe Receipt Kitchen' } },
    },
  });
  const enterprise = await prisma.enterprise.create({ data: { partyId: owner.id, workRaw: 'food', segment: 'food' } });
  const store = await prisma.store.create({
    data: { enterpriseId: enterprise.id, name: 'Probe Receipt Kitchen', slug: `probe-receipt-${Date.now()}` },
  });
  const sukuma = await prisma.product.create({ data: { storeId: store.id, name: 'Sukuma', priceKes: 150, stockQty: 40 } });
  const mandazi = await prisma.product.create({ data: { storeId: store.id, name: 'Mandazi', priceKes: 200, stockQty: 20 } });
  const posSale = await prisma.posSale.create({
    data: { storeId: store.id, clientSaleId: `probe-receipt-${Date.now()}`, paymentMethod: 'CASH', totalKes: 350, soldAt: new Date() },
  });

  const ctx: Ctx = {
    actorType: 'SUBJECT', actorId: owner.id, partyId: owner.id,
    capabilities: [...ROLE_PRESETS.SUBJECT], __verified: true,
  };

  try {
    console.log('\n== issueReceiptFor ==');
    const saleReceipt = await issueReceiptFor({
      storeId: store.id, saleId: posSale.id, totalKes: 350, buyerMsisdn: '+254712000030',
    });
    check('mints an RC-shaped, checksum-valid receiptCode', isTransactionCodeValid(saleReceipt.receiptCode ?? ''), saleReceipt.receiptCode ?? '');
    check('receiptNo is store-slug-prefixed', saleReceipt.receiptNo.startsWith(store.slug.slice(0, 12).toUpperCase()));
    check('SMS channel when a phone is given', saleReceipt.channel === 'SMS' && saleReceipt.sentTo === '+254712000030');
    check('carries the store name for the SMS composer', saleReceipt.storeName === store.name);

    const printOnly = await issueReceiptFor({ storeId: store.id, totalKes: 100, buyerMsisdn: null });
    check('PRINT channel, no sentTo, when no phone is known', printOnly.channel === 'PRINT' && printOnly.sentTo === null);

    const storeless = await issueReceiptFor({ storeId: null, businessPaymentId: null, totalKes: 80, buyerMsisdn: null });
    check('a storeless receipt still mints a code', isTransactionCodeValid(storeless.receiptCode ?? ''));
    check('a storeless receiptNo uses the fixed prefix', storeless.receiptNo.startsWith('ESOQO-'));
    check('a storeless receipt has no storeName', storeless.storeName === null);

    console.log('\n== issueReceiptFor is idempotent per payment ==');
    // Two callers racing (a Daraja redelivery, a caller that wraps the
    // mint in its own retry) must not produce two receipts — one payment,
    // one receipt, one text to the buyer. The second call returns the
    // first call's row rather than inserting a second one.
    const repeatPayment = await prisma.businessPayment.create({
      data: {
        payeePartyId: owner.id, payeeEsoqoId: 'probepay482', payeeName: store.name,
        payerMsisdn: '+254712000041', payerName: 'Repeat Buyer', amountKes: 250, status: 'CONFIRMED',
      },
    });
    const firstMint = await issueReceiptFor({ storeId: store.id, businessPaymentId: repeatPayment.id, totalKes: 250, buyerMsisdn: null });
    const secondMint = await issueReceiptFor({ storeId: store.id, businessPaymentId: repeatPayment.id, totalKes: 250, buyerMsisdn: null });
    check('a second mint for the same payment returns the first receipt, not a new one',
      firstMint.id === secondMint.id && firstMint.receiptCode === secondMint.receiptCode);
    const receiptsForPayment = await prisma.receipt.count({ where: { businessPaymentId: repeatPayment.id } });
    check('exactly one receipt row exists for that payment', receiptsForPayment === 1, `count=${receiptsForPayment}`);

    console.log('\n== issueReceipt (the manual print/SMS button) ==');
    // Before mintReceipt existed, only the automatic path minted a
    // receiptCode — so a receipt the merchant re-sent by hand from the
    // PoS terminal had no /verify code at all, and the shopper holding
    // it was holding something uncheckable.
    const manual = await issueReceipt(ctx, store.id, { saleId: posSale.id, channel: 'PRINT' });
    check('the manual path mints a code too, so it is verifiable', isTransactionCodeValid(manual.receiptCode ?? ''), manual.receiptCode ?? '');
    const manualVerified = await verifyReceipt(anonCtx(), manual.receiptCode ?? '');
    check('and that code resolves on the public verify page', manualVerified.found && manualVerified.receiptNo === manual.receiptNo);
    const manualNoSentTo = await issueReceipt(ctx, store.id, { saleId: posSale.id, channel: 'PRINT' });
    check('a print receipt carries no sentTo', manualNoSentTo.sentTo === null && manualNoSentTo.channel === 'PRINT');
    const manualSmsNoPhone = await issueReceipt(ctx, store.id, { saleId: posSale.id, channel: 'SMS' })
      .then(() => null, (e: unknown) => e);
    check('an SMS receipt with no number is still refused', manualSmsNoPhone instanceof ReceiptError);

    console.log('\n== verify projection carries the fiscal label, not just the code ==');
    check('verify exposes receiptNo (what a customer quotes back)',
      manualVerified.receiptNo === manual.receiptNo && manualVerified.receiptNo.startsWith(store.slug.slice(0, 12).toUpperCase()));
    check('an unrefunded receipt reports zero refunded', manualVerified.refundedKes === 0);

    console.log('\n== a bare BusinessPayment receipt, awaiting items ==');
    const payment = await prisma.businessPayment.create({
      data: {
        payeePartyId: owner.id, payeeEsoqoId: 'probepay482', payeeName: store.name,
        payerMsisdn: '+254712000040', payerName: 'Jane Wanjiku', amountKes: 500, status: 'CONFIRMED',
      },
    });
    const bpReceipt = await issueReceiptFor({
      storeId: store.id, businessPaymentId: payment.id, totalKes: 500, buyerMsisdn: payment.payerMsisdn,
    });
    check('attributed to the store', bpReceipt.storeId === store.id);

    const needing = await listReceiptsNeedingItems(ctx, store.id);
    check('shows up on the Needs-items list', needing.some((r) => r.id === bpReceipt.id));
    check('a sale-backed receipt never does', !needing.some((r) => r.id === saleReceipt.id));

    const pendingLookup = await verifyReceipt(anonCtx(), bpReceipt.receiptCode ?? '');
    check('verify shows itemisation pending before anything is added', pendingLookup.found && pendingLookup.itemsPending);

    console.log('\n== addReceiptItems: the amount-mismatch refusal ==');
    const mismatch = await addReceiptItems(ctx, bpReceipt.id, [
      { productId: sukuma.id, quantity: 1, unitPriceKes: 150 },
    ]).then(() => null, (e: unknown) => e);
    check('rejects a total that undershoots the amount paid',
      mismatch instanceof ReceiptError && mismatch.code === 'AMOUNT_MISMATCH', String(mismatch));

    console.log('\n== addReceiptItems: cross-store product refusal ==');
    const otherOwner = await prisma.party.create({
      data: { kind: 'ORGANISATION', county: 'Nairobi', organisation: { create: { kind: 'BUSINESS', officialName: 'Probe Receipt Other Ltd' } } },
    });
    const otherEnt = await prisma.enterprise.create({ data: { partyId: otherOwner.id, workRaw: 'food' } });
    const otherStore = await prisma.store.create({ data: { enterpriseId: otherEnt.id, name: 'Probe Receipt Other', slug: `probe-receipt-other-${Date.now()}` } });
    const otherProduct = await prisma.product.create({ data: { storeId: otherStore.id, name: 'Foreign item', priceKes: 500, stockQty: 5 } });
    const wrongStore = await addReceiptItems(ctx, bpReceipt.id, [
      { productId: otherProduct.id, quantity: 1, unitPriceKes: 500 },
    ]).then(() => null, (e: unknown) => e);
    check('rejects a product from a different store even at the right total',
      wrongStore instanceof ReceiptError && wrongStore.code === 'ITEM_UNAVAILABLE', String(wrongStore));
    await prisma.product.delete({ where: { id: otherProduct.id } });
    await prisma.store.delete({ where: { id: otherStore.id } });
    await prisma.enterprise.delete({ where: { id: otherEnt.id } });
    await prisma.organisation.delete({ where: { partyId: otherOwner.id } });
    await prisma.party.delete({ where: { id: otherOwner.id } });

    console.log('\n== addReceiptItems: shape refusals, on a receipt still awaiting items ==');
    // Every line here sums to EXACTLY the amount paid (500), so none of
    // them can be caught by the amount-matches-the-total check. They have
    // to be refused on their own shape, which is the whole reason that
    // validation exists rather than relying on the total to catch it.
    const shapePayment = await prisma.businessPayment.create({
      data: {
        payeePartyId: owner.id, payeeEsoqoId: 'probepay482', payeeName: store.name,
        payerMsisdn: '+254712000042', payerName: 'Shape Tester', amountKes: 500, status: 'CONFIRMED',
      },
    });
    const shapeReceipt = await issueReceiptFor({ storeId: store.id, businessPaymentId: shapePayment.id, totalKes: 500, buyerMsisdn: null });
    const stockBeforeShape = await prisma.product.findUnique({ where: { id: sukuma.id } });

    const negativeQty = await addReceiptItems(ctx, shapeReceipt.id, [
      { productId: sukuma.id, quantity: -5, unitPriceKes: -100 },
    ]).then(() => null, (e: unknown) => e);
    check('rejects a negative quantity that would otherwise INCREASE stock',
      negativeQty instanceof ReceiptError && negativeQty.code === 'BAD_INPUT', String(negativeQty));

    const zeroQty = await addReceiptItems(ctx, shapeReceipt.id, [
      { productId: sukuma.id, quantity: 0, unitPriceKes: 500 },
    ]).then(() => null, (e: unknown) => e);
    check('rejects a zero quantity', zeroQty instanceof ReceiptError && zeroQty.code === 'BAD_INPUT', String(zeroQty));

    const fractionalQty = await addReceiptItems(ctx, shapeReceipt.id, [
      { productId: sukuma.id, quantity: 1.5, unitPriceKes: 500 },
    ]).then(() => null, (e: unknown) => e);
    check('rejects a fractional quantity', fractionalQty instanceof ReceiptError && fractionalQty.code === 'BAD_INPUT', String(fractionalQty));

    // The one that reaches the public page: two lines that balance the
    // total exactly while describing a receipt with a NEGATIVE line on
    // it, which /verify then renders as "KES -500".
    const negativePrice = await addReceiptItems(ctx, shapeReceipt.id, [
      { productId: sukuma.id, quantity: 1, unitPriceKes: -500 },
      { productId: mandazi.id, quantity: 2, unitPriceKes: 500 },
    ]).then(() => null, (e: unknown) => e);
    check('rejects a negative price, even when the lines still total the amount paid',
      negativePrice instanceof ReceiptError && negativePrice.code === 'BAD_INPUT', String(negativePrice));

    const conflictingDupes = await addReceiptItems(ctx, shapeReceipt.id, [
      { productId: sukuma.id, quantity: 1, unitPriceKes: 150 },
      { productId: sukuma.id, quantity: 2, unitPriceKes: 200 },
      { productId: mandazi.id, quantity: 1, unitPriceKes: 0 },
    ]).then(() => null, (e: unknown) => e);
    check('refuses the same item listed twice at two different prices',
      conflictingDupes instanceof ReceiptError && conflictingDupes.code === 'BAD_INPUT', String(conflictingDupes));

    const stockAfterShape = await prisma.product.findUnique({ where: { id: sukuma.id } });
    check('none of the refused submissions moved any stock',
      stockAfterShape?.stockQty === stockBeforeShape?.stockQty,
      `before=${stockBeforeShape?.stockQty} after=${stockAfterShape?.stockQty}`);
    const stillPending = await listReceiptsNeedingItems(ctx, store.id);
    check('the receipt survived every refusal still awaiting items', stillPending.some((r) => r.id === shapeReceipt.id));
    check('and it still reads as "pending" on the verify page',
      (await verifyReceipt(anonCtx(), shapeReceipt.receiptCode ?? '')).itemsPending);

    console.log('\n== addReceiptItems: duplicate lines aggregate, stock compounds once ==');
    // The stale-snapshot bug: 3 sukuma at 150 = 450, plus 1 mandazi at
    // 50 = 500. Submitted as two separate lines for the same product,
    // which the old per-line loop would each compute as max(0, 40-3)
    // off the same pre-transaction read, landing on 37 instead of 34.
    const dupePayment = await prisma.businessPayment.create({
      data: {
        payeePartyId: owner.id, payeeEsoqoId: 'probepay482', payeeName: store.name,
        payerMsisdn: '+254712000043', payerName: 'Dupe Buyer', amountKes: 500, status: 'CONFIRMED',
      },
    });
    const dupeReceipt = await issueReceiptFor({ storeId: store.id, businessPaymentId: dupePayment.id, totalKes: 500, buyerMsisdn: null });
    const sukumaBeforeDupes = (await prisma.product.findUnique({ where: { id: sukuma.id } }))!.stockQty!;
    const dupeResult = await addReceiptItems(ctx, dupeReceipt.id, [
      { productId: sukuma.id, quantity: 2, unitPriceKes: 150 },
      { productId: sukuma.id, quantity: 1, unitPriceKes: 150 },
      { productId: mandazi.id, quantity: 1, unitPriceKes: 50 },
    ]);
    check('two lines for one product collapse to a single ReceiptItem row',
      dupeResult.items.length === 2, `items=${dupeResult.items.length}`);
    const sukumaAfterDupes = (await prisma.product.findUnique({ where: { id: sukuma.id } }))!.stockQty!;
    check('stock is decremented by the combined quantity, not once per line',
      sukumaAfterDupes === Math.max(0, sukumaBeforeDupes - 3),
      `before=${sukumaBeforeDupes} after=${sukumaAfterDupes} expected=${Math.max(0, sukumaBeforeDupes - 3)}`);

    console.log('\n== addReceiptItems: the itemizedAt claim under real concurrency ==');
    // The one-shot guard is a conditional claim inside the transaction,
    // so of N truly simultaneous calls exactly one can win. This is the
    // check that cannot be written as a sequential "call it twice" — the
    // bug it guards against only appears when both callers read "no
    // items yet" before either has written one.
    const racePayment = await prisma.businessPayment.create({
      data: {
        payeePartyId: owner.id, payeeEsoqoId: 'probepay482', payeeName: store.name,
        payerMsisdn: '+254712000044', payerName: 'Race Buyer', amountKes: 500, status: 'CONFIRMED',
      },
    });
    const raceReceipt = await issueReceiptFor({ storeId: store.id, businessPaymentId: racePayment.id, totalKes: 500, buyerMsisdn: null });
    const raceLine = [{ productId: mandazi.id, quantity: 1, unitPriceKes: 500 }];
    const mandaziBeforeRace = (await prisma.product.findUnique({ where: { id: mandazi.id } }))!.stockQty!;
    const raceResults = await Promise.allSettled([
      addReceiptItems(ctx, raceReceipt.id, raceLine),
      addReceiptItems(ctx, raceReceipt.id, raceLine),
      addReceiptItems(ctx, raceReceipt.id, raceLine),
    ]);
    const raceWins = raceResults.filter((r) => r.status === 'fulfilled').length;
    const raceRows = await prisma.receiptItem.count({ where: { receiptId: raceReceipt.id } });
    check('exactly one of three simultaneous submissions wins', raceWins === 1, `wins=${raceWins}`);
    check('and exactly one ReceiptItem row exists — no double write', raceRows === 1, `rows=${raceRows}`);
    const mandaziAfterRace = (await prisma.product.findUnique({ where: { id: mandazi.id } }))!.stockQty!;
    check('stock was decremented exactly once for the single winning line',
      mandaziAfterRace === Math.max(0, mandaziBeforeRace - 1),
      `before=${mandaziBeforeRace} after=${mandaziAfterRace}`);
    console.log('\n== addReceiptItems: the happy path ==');
    const entriesBefore = await prisma.journalEntry.count();
    // Relative, not absolute: the refusal/race sections above move stock
    // on purpose, so pinning 38/19 here would only assert this script's
    // own ordering. What matters is that this call moves each line by its
    // own quantity.
    const sukumaBeforeHappy = (await prisma.product.findUnique({ where: { id: sukuma.id } }))!.stockQty!;
    const mandaziBeforeHappy = (await prisma.product.findUnique({ where: { id: mandazi.id } }))!.stockQty!;
    const itemized = await addReceiptItems(ctx, bpReceipt.id, [
      { productId: sukuma.id, quantity: 2, unitPriceKes: 150 },
      { productId: mandazi.id, quantity: 1, unitPriceKes: 200 },
    ]);
    check('returns the receipt with its items', itemized.items.length === 2);
    const entriesAfter = await prisma.journalEntry.count();
    check('posts nothing to the ledger — the payment already did',
      entriesAfter === entriesBefore, `before=${entriesBefore} after=${entriesAfter}`);

    const sukumaAfter = await prisma.product.findUnique({ where: { id: sukuma.id } });
    const mandaziAfter = await prisma.product.findUnique({ where: { id: mandazi.id } });
    check('decrements stock for each line',
      sukumaAfter?.stockQty === Math.max(0, sukumaBeforeHappy - 2) && mandaziAfter?.stockQty === Math.max(0, mandaziBeforeHappy - 1),
      `sukuma=${sukumaAfter?.stockQty} mandazi=${mandaziAfter?.stockQty}`);
    const sukumaSettled = sukumaAfter?.stockQty!;
    const mandaziSettled = mandaziAfter?.stockQty!;

    console.log('\n== addReceiptItems: one-shot, not an editor ==');
    const secondAttempt = await addReceiptItems(ctx, bpReceipt.id, [
      { productId: sukuma.id, quantity: 1, unitPriceKes: 500 },
    ]).then(() => null, (e: unknown) => e);
    check('refuses a second call on an already-itemized receipt',
      secondAttempt instanceof ReceiptError && secondAttempt.code === 'ALREADY_ITEMIZED', String(secondAttempt));
    const sukumaUnchanged = await prisma.product.findUnique({ where: { id: sukuma.id } });
    const mandaziUnchanged = await prisma.product.findUnique({ where: { id: mandazi.id } });
    check('the refused second call touched no stock',
      sukumaUnchanged?.stockQty === sukumaSettled && mandaziUnchanged?.stockQty === mandaziSettled);
    check('the receipt is claimed, so it can never be re-entered',
      !!(await prisma.receipt.findUnique({ where: { id: bpReceipt.id } }))!.itemizedAt);

    console.log('\n== after itemization ==');
    const needingAfter = await listReceiptsNeedingItems(ctx, store.id);
    check('drops off the Needs-items list once itemized', !needingAfter.some((r) => r.id === bpReceipt.id));

    const full = await getReceipt(ctx, bpReceipt.id);
    check('getReceipt carries the items with product names',
      full.items.some((i) => i.product.name === 'Sukuma' && i.quantity === 2));

    const verified = await verifyReceipt(anonCtx(), bpReceipt.receiptCode ?? '');
    check('public verify now shows the items, not "pending"', verified.found && !verified.itemsPending);
    check('verify total matches what was paid', verified.totalKes === 500);
    check('verify carries no buyer phone number', !JSON.stringify(verified).includes('712000040'));

    console.log('\n== a refunded sale is not reported as a clean receipt ==');
    // The whole reason the verify projection reads PosRefund: a receipt
    // is a durable public URL read long after the money moved, and
    // "this receipt is real" and "this money is still with the shop" are
    // different claims. A fully reversed sale answering the second one
    // with a green tick is the exact thing a customer disputing a charge
    // would take at face value.
    const beforeRefund = await verifyReceipt(anonCtx(), saleReceipt.receiptCode ?? '');
    check('before any refund, the sale receipt reports nothing refunded',
      beforeRefund.found && beforeRefund.refundedKes === 0, `refunded=${beforeRefund.refundedKes}`);

    await prisma.posSale.update({ where: { id: posSale.id }, data: { status: 'REFUNDED' } });
    await prisma.posRefund.create({
      data: { saleId: posSale.id, storeId: store.id, reason: 'Customer returned the goods', refundMethod: 'MPESA_STK', amountKes: 350 },
    });
    const afterFullRefund = await verifyReceipt(anonCtx(), saleReceipt.receiptCode ?? '');
    check('a fully refunded sale reports the whole amount refunded',
      afterFullRefund.refundedKes === 350, `refunded=${afterFullRefund.refundedKes}`);
    check('and the receipt still resolves — a refund does not erase it',
      afterFullRefund.found && afterFullRefund.totalKes === 350);
    check('a refund never leaks a payer number onto the public projection',
      !JSON.stringify(afterFullRefund).includes('712000'));

    await prisma.posRefund.create({
      data: { saleId: posSale.id, storeId: store.id, reason: 'Second, partial return', refundMethod: 'CASH', amountKes: 100 },
    });
    const overRefund = await verifyReceipt(anonCtx(), saleReceipt.receiptCode ?? '');
    check('refunds accumulate across several records', overRefund.refundedKes === 450, `refunded=${overRefund.refundedKes}`);

    // A receipt with no sale can never carry a refund, so the projection
    // must report zero rather than accidentally joining on the wrong row.
    check('a BusinessPayment-backed receipt reports nothing refunded', pendingLookup.refundedKes === 0);

    console.log('\n== verifyReceipt refusals ==');
    const noSuchCode = await verifyReceipt(anonCtx(), 'RC260101ZZZZZZ');
    check('an unissued code is not found', noSuchCode.found === false);
  } finally {
    console.log('\n== cleanup ==');
    await sweep();
    console.log(`\n${pass} passed, ${fail} failed\n`);
  }
  if (fail > 0) process.exitCode = 1;
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
