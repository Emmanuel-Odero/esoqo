/**
 * End-to-end runtime check of the /pay money path, against the real
 * database and the console M-Pesa provider.
 *
 * This exists because the interesting failures in a payment flow are not
 * type errors. They are the ones where every function is individually
 * correct and the chain is wrong: a status written before the push, a
 * ledger that double-posts on a replayed callback, an SMS that only
 * renders for the payee and not the owner, a failed push left PENDING
 * forever. None of that shows up in a unit test with a mock DAL.
 *
 * So this drives the same functions the server action and the webhook
 * use, in the same order, and then reads the resulting rows back out of
 * Postgres to check what actually landed. The callback leg goes through
 * `parseStkCallback` with a realistic Daraja-shaped body rather than
 * calling `confirmBusinessPayment` with the push's own return values —
 * the whole risk of a webhook is that it arrives as something other
 * than the object you just built.
 *
 * Run with:  pnpm --filter @esoqo/core-service verify:pay
 *
 * Every row it creates is deleted at the end, so it is safe to run
 * against a development database repeatedly.
 */

// .mts, not .ts, on purpose: @esoqo/db is TypeScript source consumed
// straight out of node_modules, and its barrel mixes explicit re-exports
// with `export *`. Node can only see the former when it has to guess at
// named exports across the CJS/ESM boundary, so a .ts (CJS) importer
// silently loses everything reachable only through `export *` — anonCtx
// included. Forcing ESM gets the whole namespace.
// A dynamic import, not a static one. @esoqo/db is TypeScript source
// consumed straight out of node_modules, and its barrel mixes explicit
// re-exports with `export *`. Node can only see the explicit ones when it
// has to guess at a module's named exports, so a static import of
// anything reachable only through `export *` — anonCtx among them — comes
// back undefined at runtime while typechecking perfectly. A dynamic
// import gets the real namespace. That is also why packages/db/src/index.ts
// spells out the business-payment and donation re-exports by hand.
const db = await import('@esoqo/db');

const {
  prisma, anonCtx, lookupPayee, createBusinessPayment,
  attachBusinessPaymentCheckoutRequestId,
  confirmBusinessPayment, failBusinessPaymentById,
  BusinessPaymentError,
} = db;
import { payerPaymentReceiptSms, businessPaymentAlertSms } from '@esoqo/domain';

// Forced, not inherited: @esoqo/payments resolves its provider once at
// import time, and this script must be deterministic and must never push
// a prompt to Safaricom, whatever the ambient .env says. The sandbox
// path is exercised for real by running /pay against a sandbox
// credential — the point here is the chain, not the network.
process.env.MPESA_PROVIDER = 'console';
const { initiateStkPush, parseStkCallback } = await import('@esoqo/payments');

const ctx = anonCtx();

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name: string): void {
  console.log(`\n${name}`);
}

/** A Daraja STK callback body, exactly as Safaricom posts it. */
function callbackBody(opts: {
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  receipt?: string;
}): unknown {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: opts.checkoutRequestId,
        CheckoutRequestID: opts.checkoutRequestId,
        ResultCode: opts.resultCode,
        ResultDesc: opts.resultDesc,
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 1500 },
            // Daraja's own name for it. parseStkCallback looks for
            // MpesaReceiptNumber specifically, which is what Safaricom
            // actually sends — a fixture that used a friendlier key
            // would pass a parser that ignores every real callback.
            { Name: 'MpesaReceiptNumber', Value: opts.receipt ?? 'CJ7ABCDE' },
            { Name: 'TransactionDate', Value: new Date().toISOString() },
            { Name: 'PhoneNumber', Value: '254712345678' },
          ],
        },
      },
    },
  };
}

const createdPaymentIds: string[] = [];

async function cleanup(): Promise<void> {
  if (createdPaymentIds.length === 0) return;
  // The journal entry has to go explicitly, and first. It is not
  // cascaded from the payment: the FK runs the other way (BusinessPayment
  // holds the unique journalEntryId), so deleting the payment leaves the
  // entry and its two postings behind, still counted on the accounts —
  // every run of this script quietly added its test money to the
  // BUSINESS_REVENUE and SETTLEMENT balances. Postings, in turn, do
  // cascade from the entry, so that one delete is enough.
  const rows = await prisma.businessPayment.findMany({
    where: { id: { in: createdPaymentIds } },
    select: { journalEntryId: true },
  });
  const entryIds = rows.flatMap((r) => (r.journalEntryId ? [r.journalEntryId] : []));
  if (entryIds.length > 0) {
    await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
  }
  await prisma.businessPayment.deleteMany({ where: { id: { in: createdPaymentIds } } });
  console.log(
    `\ncleaned up ${createdPaymentIds.length} payment row(s) and ${entryIds.length} journal entry/entries`,
  );
}

async function main(): Promise<void> {
  console.log('M-Pesa provider: console (no real money moves)');

  /* ── 1. a payee a customer can actually pay ─────────────────────────── */

  section('1. Payee resolution');
  // The first issued business ID from the database rather than a
  // hardcoded one, since seeds change and the dev DB is not sacred.
  const anyId = await prisma.esoqoPaymentId.findFirst({
    where: { party: { organisation: { isNot: null } } },
    orderBy: { code: 'asc' },
  });
  check('a business with an issued Esoqo ID exists', !!anyId, 'run the seed first');
  if (!anyId) return finish();

  const byCode = await lookupPayee(ctx, anyId.code);
  check('lookup by Esoqo ID finds the payee', byCode.status === 'FOUND', `got ${byCode.status}`);
  const payee = byCode.status === 'FOUND' ? byCode.businesses.at(0) : undefined;
  check('the payee list is not empty', !!payee);
  if (!payee) return;
  check('the payee reports an organisation kind', !!payee?.kind, payee?.kind);
  check('the payee has a display name', !!payee?.name && !payee.name.includes('undefined'), payee?.name);
  check('the payee exposes no contact details',
    !('msisdn' in (payee ?? {})) && !('email' in (payee ?? {})));

  const byLegacy = await lookupPayee(ctx, anyId.code.toLowerCase());
  check('lookup is case-insensitive', byLegacy.status === 'FOUND', `got ${byLegacy.status}`);

  const byJunk = await lookupPayee(ctx, 'not-a-real-code');
  check('an unresolvable identifier is not a payable business', byJunk.status !== 'FOUND', byJunk.status);

  // A person holding an Esoqo ID is not a business anyone can pay. This
  // is the check that keeps /pay from becoming a person-to-person
  // transfer rail by accident.
  const person = await prisma.esoqoPaymentId.findFirst({
    where: { party: { kind: 'PERSON', organisation: { is: null } } },
    orderBy: { code: 'asc' },
  });
  if (person) {
    const byPerson = await lookupPayee(ctx, person.code);
    check('a person\'s Esoqo ID is not payable', byPerson.status !== 'FOUND',
      `${person.code} -> ${byPerson.status}`);
  } else {
    check('a person\'s Esoqo ID is not payable', true, 'skipped: no person IDs issued');
  }

  /* ── 2. the console path: what the /pay action does ──────────────────── */

  section('2. Console path — persist, push, attach, confirm');
  const amountKes = 1500;
  const payment = await createBusinessPayment(ctx, {
    payeePartyId: payee.partyId,
    amountKes,
    payerMsisdn: '0712345678',
    payerName: 'Runtime Check',
  });
  createdPaymentIds.push(payment.id);
  check('the payment starts PENDING', payment.status === 'PENDING', payment.status);
  check('the payee is stored with the payment', payment.payeeName === payee.name, payment.payeeName);
  check('the amount is stored exactly', Number(payment.amountKes) === amountKes, String(payment.amountKes));

  const push = await initiateStkPush({
    msisdn: payment.payerMsisdn,
    amountKes: amountKes,
    accountReference: `ESOQO ${payment.payeeEsoqoId}`,
    description: `Payment to ${payment.payeeName}`,
  });
  check('the console provider auto-confirms', push.autoConfirmed);
  check('the push returns a checkout request id', !!push.checkoutRequestId);
  check('the push returns a receipt code', !!push.mpesaReceiptCode);

  const attached = await attachBusinessPaymentCheckoutRequestId(payment.id, push.checkoutRequestId);
  check('the checkout request id attaches to the right row', attached.id === payment.id);

  const confirmed = await confirmBusinessPayment(push.checkoutRequestId, push.mpesaReceiptCode ?? '');
  check('confirming by checkout id reports justConfirmed', confirmed.justConfirmed);
  check('confirming reports the payee name', confirmed.payment.payeeName === payee.name, confirmed.payment.payeeName);
  check('an Esoqo receipt code is minted', !!confirmed.payment.receiptCode, String(confirmed.payment.receiptCode));
  check('the Safaricom receipt is recorded',
    confirmed.payment.mpesaReceiptCode === push.mpesaReceiptCode, String(confirmed.payment.mpesaReceiptCode));
  check('the notification names the business', confirmed.notify?.businessName === payee.name, confirmed.notify?.businessName);
  check('the notification carries the payee ID for the pay link', confirmed.notify?.payeeEsoqoId === payee.esoqoId);
  check('the notification has a payer number', !!confirmed.notify?.payerMsisdn);
  check('the notification has an amount', confirmed.notify?.amountKes === amountKes, String(confirmed.notify?.amountKes));
  check('a business with no reachable members gets an empty list, not an error',
    Array.isArray(confirmed.notify?.businessMsisdns));

  const replay = await confirmBusinessPayment(push.checkoutRequestId, push.mpesaReceiptCode ?? '');
  check('a replayed callback is not justConfirmed again', !replay.justConfirmed);

  /* ── 3. the ledger actually balanced ────────────────────────────────── */

  section('3. Ledger');
  // Whether an entry actually balances, and whether BUSINESS_REVENUE and
  // SETTLEMENT are the two accounts it touches, is packages/db/scripts/
  // verify-business-payment.ts's job — it asserts that in more detail
  // against its own fixture. What's worth checking again here is the
  // one thing only a script that drives the *chain* can see: the entry
  // this specific push produced is the one keyed to this checkout
  // request, not some other payment's.
  const postings = await prisma.posting.findMany({
    where: { entry: { businessPayment: { id: payment.id } } },
    include: { account: true, entry: { include: { businessPayment: true } } },
  });
  check('the payment posted two postings', postings.length === 2, `${postings.length} postings`);
  const entry = postings.at(0)?.entry;
  check('the entry is keyed to the checkout request', entry?.idempotencyKey === push.checkoutRequestId, String(entry?.idempotencyKey));
  check('the entry references the payment', entry?.businessPayment?.id === payment.id, String(entry?.businessPayment?.id));
  check('the entry is in KES', postings.every((p) => p.currency === 'KES'));

  // The whole point of the replay guard: no second entry, and no
  // overwriting of Safaricom's receipt by a duplicate callback.
  await confirmBusinessPayment(push.checkoutRequestId, push.mpesaReceiptCode ?? '');
  await confirmBusinessPayment(push.checkoutRequestId, 'SOMETHINGELSE');
  const afterReplay = await prisma.posting.count({ where: { entry: { businessPayment: { id: payment.id } } } });
  check('three confirmations still post exactly two postings', afterReplay === 2, `${afterReplay} postings`);
  const stillOriginal = await prisma.businessPayment.findUnique({ where: { id: payment.id } });
  check('a replay does not overwrite the receipt',
    stillOriginal?.mpesaReceiptCode === push.mpesaReceiptCode, String(stillOriginal?.mpesaReceiptCode));

  // The status query settles a payment the callback missed, and Daraja's
  // query response has no CallbackMetadata — so a query-settled payment
  // has no M-Pesa code, and the callback that eventually lands is the
  // only copy that will ever exist. It must be taken, not discarded.
  const viaQuery = await createBusinessPayment(ctx, {
    payeePartyId: payee.partyId,
    amountKes: 555,
    payerMsisdn: '0712345678',
  });
  createdPaymentIds.push(viaQuery.id);
  await attachBusinessPaymentCheckoutRequestId(viaQuery.id, 'ws_CO_NOQUERYMETA');
  const querySettled = await confirmBusinessPayment('ws_CO_NOQUERYMETA', '');
  check('a payment settled without a query receipt code confirms',
    querySettled.justConfirmed && !querySettled.payment.mpesaReceiptCode,
    String(querySettled.payment.mpesaReceiptCode));
  const late = await confirmBusinessPayment('ws_CO_NOQUERYMETA', 'LATE12345');
  check('a late callback backfills the M-Pesa code the query could not supply',
    late.payment.mpesaReceiptCode === 'LATE12345', String(late.payment.mpesaReceiptCode));
  check('backfilling a receipt does not re-announce the payment', !late.justConfirmed);
  check('backfilling a receipt moves no money',
    (await prisma.posting.count({ where: { entry: { businessPayment: { id: viaQuery.id } } } })) === 2,
    'postings');

  // The replay guard above is sequential. Two paths can also confirm at
  // the same instant: Safaricom's callback landing while the waiting
  // screen's own status query is in flight. Both read PENDING, so only an
  // atomic claim can stop them both posting — and only the winner may
  // send a receipt, or the shopper is thanked twice for one payment.
  const raced = await createBusinessPayment(ctx, {
    payeePartyId: payee.partyId,
    amountKes: 640,
    payerMsisdn: '0712345678',
  });
  createdPaymentIds.push(raced.id);
  await attachBusinessPaymentCheckoutRequestId(raced.id, 'ws_CO_RACE');
  const racers = await Promise.all([
    confirmBusinessPayment('ws_CO_RACE', 'RACERECEIPT1'),
    confirmBusinessPayment('ws_CO_RACE', 'RACERECEIPT2'),
  ]);
  const winners = racers.filter((r) => r.justConfirmed);
  check('exactly one of two concurrent confirmations reports justConfirmed',
    winners.length === 1, `${winners.length} claimed it`);
  const racePostings = await prisma.posting.count({ where: { entry: { businessPayment: { id: raced.id } } } });
  check('a concurrent double-confirm still posts exactly two postings',
    racePostings === 2, `${racePostings} postings`);
  const raceEntries = await prisma.journalEntry.count({
    where: { idempotencyKey: 'ws_CO_RACE' },
  });
  check('a concurrent double-confirm leaves exactly one journal entry',
    raceEntries === 1, `${raceEntries} entries`);
  check('the loser reports not-just-confirmed so no second receipt is sent',
    racers.filter((r) => !r.justConfirmed).every((r) => !r.notify), 'loser carried a notify payload');

  /* ── 4. the webhook path, as Safaricom actually posts it ─────────────── */

  section('4. Webhook path — a Daraja-shaped callback');
  const web = await createBusinessPayment(ctx, {
    payeePartyId: payee.partyId,
    amountKes: 750,
    payerMsisdn: '0712345678',
  });
  createdPaymentIds.push(web.id);
  const webPush = await initiateStkPush({
    msisdn: web.payerMsisdn, amountKes: 750,
    accountReference: `ESOQO ${web.payeeEsoqoId}`,
    description: `Payment to ${web.payeeName}`,
  });
  await attachBusinessPaymentCheckoutRequestId(web.id, webPush.checkoutRequestId);

  const parsed = parseStkCallback(callbackBody({
    checkoutRequestId: webPush.checkoutRequestId,
    resultCode: 0,
    resultDesc: 'The service provider successfully processed the request.',
    receipt: 'LKN7RT8Q',
  }));
  check('the callback parses', parsed !== null);
  check('the parsed callback reports success', parsed?.succeeded === true);
  check('the parsed callback keeps the checkout id', parsed?.checkoutRequestId === webPush.checkoutRequestId);
  check('the parsed callback reads the receipt number', parsed?.mpesaReceiptCode === 'LKN7RT8Q');

  if (parsed) {
    const webConfirmed = await confirmBusinessPayment(parsed.checkoutRequestId, parsed.mpesaReceiptCode ?? '');
    check('the webhook confirms the payment', webConfirmed.justConfirmed);
    check('Safaricom\'s receipt is recorded',
      webConfirmed.payment.mpesaReceiptCode === 'LKN7RT8Q', String(webConfirmed.payment.mpesaReceiptCode));
    check('Esoqo\'s own receipt is separate from it',
      !!webConfirmed.payment.receiptCode && webConfirmed.payment.receiptCode !== 'LKN7RT8Q',
      String(webConfirmed.payment.receiptCode));
    const webPostings = await prisma.posting.findMany({ where: { entry: { businessPayment: { id: web.id } } } });
    check('the webhook payment posted a balanced entry',
      webPostings.length === 2 && Math.abs(webPostings.reduce((a, l) => a + Number(l.amount), 0)) < 0.005,
      `${webPostings.length} postings`);
  }

  const garbage = parseStkCallback({ Body: { stkCallback: { ResultCode: 0 } } });
  check('a callback with no checkout id is not parsed', garbage === null);
  const empty = parseStkCallback({ hello: 'world' });
  check('an unrelated body is not parsed', empty === null);

  /* ── 5. the unhappy paths ────────────────────────────────────────────── */

  section('5. Failure paths');
  const failed = await createBusinessPayment(ctx, {
    payeePartyId: payee.partyId,
    amountKes: 300,
    payerMsisdn: '0712345678',
  });
  createdPaymentIds.push(failed.id);
  const failPush = await initiateStkPush({
    msisdn: failed.payerMsisdn, amountKes: 300,
    accountReference: `ESOQO ${failed.payeeEsoqoId}`,
    description: `Payment to ${failed.payeeName}`,
  });
  await attachBusinessPaymentCheckoutRequestId(failed.id, failPush.checkoutRequestId);

  const declined = parseStkCallback(callbackBody({
    checkoutRequestId: failPush.checkoutRequestId,
    resultCode: 1032,
    resultDesc: 'Request cancelled by user',
  }));
  check('a cancelled prompt parses as a failure', declined?.succeeded === false);
  if (declined) {
    // The webhook resolves the payment by checkout id; the action has
    // only the row id, so both entry points must work.
    await failBusinessPaymentById(failed.id, declined.resultDescription);
    const afterFail = await prisma.businessPayment.findUnique({ where: { id: failed.id } });
    check('a cancelled payment is FAILED', afterFail?.status === 'FAILED', afterFail?.status);
    check('the reason is kept', afterFail?.failureReason === 'Request cancelled by user', afterFail?.failureReason ?? '');
    check('a failed payment holds no receipt code', !afterFail?.receiptCode);
  }
  const failPostings = await prisma.posting.count({ where: { entry: { businessPayment: { id: failed.id } } } });
  check('a failed payment posts nothing to the ledger', failPostings === 0, `${failPostings} postings`);

  section('6. Guards');
  const tooBig = await createBusinessPayment(ctx, {
    payeePartyId: payee.partyId, amountKes: 99_999_999, payerMsisdn: '0712345678',
  }).then(() => null).catch((e) => e);
  check('an absurd amount is refused', tooBig instanceof BusinessPaymentError,
    tooBig instanceof Error ? tooBig.message : 'no error raised');
  const negative = await createBusinessPayment(ctx, {
    payeePartyId: payee.partyId, amountKes: -50, payerMsisdn: '0712345678',
  }).then(() => null).catch((e) => e);
  check('a negative amount is refused', negative instanceof BusinessPaymentError,
    negative instanceof Error ? negative.message : 'no error raised');
  const notPayable = await createBusinessPayment(ctx, {
    payeePartyId: '00000000-0000-0000-0000-000000000000', amountKes: 100, payerMsisdn: '0712345678',
  }).then(() => null).catch((e) => e);
  check('an unknown payee is refused', notPayable instanceof BusinessPaymentError,
    notPayable instanceof Error ? notPayable.message : 'no error raised');
  const badPhone = await createBusinessPayment(ctx, {
    payeePartyId: payee.partyId, amountKes: 100, payerMsisdn: '123',
  }).then(() => null).catch((e) => e);
  check('an invalid MSISDN is refused', badPhone instanceof BusinessPaymentError,
    badPhone instanceof Error ? badPhone.message : 'no error raised');

  /* ── 7. the SMS a payer and an owner actually receive ────────────────── */

  section('7. SMS composition');
  const n = confirmed.notify;
  check('a confirmed payment produces notification data', !!n);
  if (!n) return;
  const payerMsg = payerPaymentReceiptSms(n);
  const ownerMsg = businessPaymentAlertSms(n);
  check('the payer is told the amount', payerMsg.includes('1,500'), payerMsg);
  check('the payer is told who they paid', payerMsg.includes(payee.name.slice(0, 20)), payerMsg);
  check('the payer gets Esoqo\'s receipt', payerMsg.includes(n.receiptCode), payerMsg);
  check('the payer SMS fits one GSM segment', [...payerMsg].length <= 160, `${[...payerMsg].length} chars`);
  check('the owner is told the amount', ownerMsg.includes('1,500'), ownerMsg);
  check('the owner is told who paid', ownerMsg.includes('+254712345678'), ownerMsg);
  check('the owner is told the number in normalised form, not as typed',
    !ownerMsg.includes('0712345678'), ownerMsg);
  check('the owner SMS fits one GSM segment', [...ownerMsg].length <= 160, `${[...ownerMsg].length} chars`);
  check('the owner SMS does not leak the payer\'s name', !ownerMsg.includes('Runtime Check'), ownerMsg);

  // Both references, and the distinction that matters: Safaricom's code
  // is the one the owner's M-Pesa statement shows, ours is the one a
  // support agent can look up. Neither stands in for the other, so both
  // ride along — and the code is optional, so both messages have to
  // survive its absence.
  const mpesa = confirmed.payment.mpesaReceiptCode;
  check('the notification carries Safaricom\'s M-Pesa code', !!n.mpesaReceiptCode, String(n.mpesaReceiptCode));
  check('the notification\'s M-Pesa code is the one on the payment',
    n.mpesaReceiptCode === mpesa, `${String(n.mpesaReceiptCode)} vs ${String(mpesa)}`);
  check('the payer is given the M-Pesa code', payerMsg.includes(String(mpesa)), payerMsg);
  check('the owner is given the M-Pesa code', ownerMsg.includes(String(mpesa)), ownerMsg);
  check('the two references are not conflated', n.receiptCode !== n.mpesaReceiptCode,
    `${n.receiptCode} vs ${String(n.mpesaReceiptCode)}`);
  const noCodePayer = payerPaymentReceiptSms({ ...n, mpesaReceiptCode: null });
  const noCodeOwner = businessPaymentAlertSms({ ...n, mpesaReceiptCode: null });
  check('a missing M-Pesa code is omitted, not left dangling',
    !noCodePayer.includes('M-Pesa') && !noCodeOwner.includes('M-Pesa'), `${noCodePayer} / ${noCodeOwner}`);
  check('the messages still fit a segment without the M-Pesa code',
    [...noCodePayer].length <= 160 && [...noCodeOwner].length <= 160,
    `${[...noCodePayer].length} / ${[...noCodeOwner].length}`);

  // The receipt carries no link. The only pay link that exists opens the
  // form that asks for money again, so a shopper holding a receipt for a
  // payment they already made would be one tap from paying twice. This
  // is checked against the real notification payload, not a fixture, so
  // a sender that starts passing a link again fails here.
  check('the payer receipt carries no pay link',
    !payerMsg.includes('http') && !payerMsg.includes('Keep'), payerMsg);
  check('the owner alert carries no pay link either',
    !ownerMsg.includes('http') && !ownerMsg.includes('Keep'), ownerMsg);
  check('the longest possible receipt still fits one GSM segment',
    [...payerPaymentReceiptSms({
      amountKes: 9_999_999,
      businessName: 'Mama Mboga Kitchen Thika Road Outlet Number Forty Two',
      receiptCode: 'BP-7K3H92XQ-EXTRA', mpesaReceiptCode: 'UIQRI7ZKTH',
    })].length <= 160);
  // With the link gone there is real headroom left for receipt content,
  // which is the better use of the segment.
  check('the receipt spends well under one segment, leaving room to grow',
    [...payerMsg].length <= 110, `${[...payerMsg].length} chars`);
}

async function finish(): Promise<void> {
  await cleanup();
  await prisma.$disconnect();
  console.log(`\n${failures.length ? 'FAILED' : 'PASSED'}: ${passed} checks passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(failures.length ? 1 : 0);
}

main()
  .then(finish)
  .catch(async (e) => {
    console.error('\nscript threw:', e);
    await cleanup().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
