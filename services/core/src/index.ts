import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import {
  prisma,
  verifyChain, confirmStoreOrderPayment, confirmRegistrationPaymentByCheckoutId,
  confirmRegistrationPaymentByPesapalOrderId,
  confirmDonationPayment, failDonationPayment,
  confirmBusinessPayment, failBusinessPayment,
  confirmWalletTopUp, WalletTopUpError,
  confirmSignatoryFeePayment, TreasuryError,
  confirmWalletWithdrawal, failWalletWithdrawalById, WalletWithdrawalError,
  confirmThirdPartyPayout, failThirdPartyPayoutById, ThirdPartyPayoutError,
  StoreOrderError, DonationError, BusinessPaymentError,
} from '@esoqo/db';
import {
  appEnv, donorThankYouSms, adminDonationAlertSms,
  payerPaymentReceiptSms, businessPaymentAlertSms, purchaseReceiptSms,
  walletWithdrawalConfirmedSms, walletTopUpConfirmedSms,
} from '@esoqo/domain';
// Subpath import, not the '@esoqo/auth' barrel — the barrel's index.ts
// also re-exports pin.ts/session.ts/redis.ts/etc., which DO carry the
// `server-only` marker and throw outside a Next.js bundling context.
// sms.ts itself deliberately doesn't (see its own header comment).
import { sendSms } from '@esoqo/auth/sms';
import { parseStkCallback, parsePesapalIpn, confirmPesapalOrder, parseB2CResultCallback } from '@esoqo/payments';
import { cecfRoutes } from './routes/cecf';
import { jamiiDomainsRoutes, runJamiiDomainReconcile } from './routes/jamii-domains';
import { jamiiDomainProvider } from './lib/cloudflare-saas';
import { runContributionGapDigest } from './jobs/group-alerts';

/**
 * services/core — the domain API for the core plane.
 *
 * Phase 0 scope: health, readiness and audit-chain verification, so the
 * two-plane deployment can be proven end to end before any domain
 * endpoint exists. Everything else arrives in Phase 1 with the channels
 * service, which is this service's first real consumer.
 */
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info',
    redact: ['req.headers.authorization', 'req.headers.cookie', '*.msisdn', '*.email'] },
  trustProxy: true,
  bodyLimit: 256 * 1024, // Server Action payloads are capped upstream too
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
await app.register(cecfRoutes);
await app.register(jamiiDomainsRoutes);

/**
 * The platform's restart probe (render.yaml's healthCheckPath). This
 * returned 200 unconditionally, so an unreachable database, a wrong
 * DATABASE_URL or an unmigrated schema all reported healthy while every
 * real request 500'd — the deploy went green on a service that could not
 * serve anything.
 *
 * A cheap reachability ping on purpose, not /ready's audit-chain walk:
 * failing liveness on a data-integrity problem turns one broken audit
 * link into a restart loop.
 */
app.get('/health', async (_req, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    app.log.error(e, 'health check failed: database unreachable');
    return reply.code(503).send({ ok: false, service: 'core', reason: 'database_unreachable' });
  }
  return { ok: true, service: 'core', ts: new Date().toISOString() };
});

app.get('/ready', async (_req, reply) => {
  try {
    const chain = await verifyChain(200);
    if (!chain.ok) {
      app.log.error({ chain }, 'audit chain broken');
      return reply.code(503).send({ ok: false, reason: 'audit_chain_broken' });
    }
    return { ok: true, auditEvents: chain.checked };
  } catch (e) {
    app.log.error(e, 'readiness check failed');
    return reply.code(503).send({ ok: false });
  }
});

/**
 * Safaricom's confirmation for an STK push, arriving asynchronously —
 * sometimes twice, sometimes not at all. This is the "real HTTP
 * endpoint" both the store checkout flow and /join's "pay now" option
 * need, and the first genuine consumer of this service beyond /health
 * and /ready.
 *
 * A single checkout can only ever belong to one of the things here —
 * store checkout, a registration fee, an Our Jamii donation, or a /pay
 * business payment — so this tries the store order first and falls
 * through to registration, donation, then business, only on a NOT_FOUND
 * from the attempt before it. Ticketing bookings and short-route fares
 * are confirmed by services/core-go (sole writer since the console
 * migration) and are forwarded there below — Go's confirms are
 * idempotent, so a callback seen by both services can never double-post.
 */
/**
 * Daraja authenticates nothing — no signature, no HMAC, no documented
 * source-IP range — so the only thing distinguishing a real callback
 * from anyone POSTing "payment confirmed" for a guessed checkout id is
 * that the URL carries a secret path segment only Safaricom was handed.
 * MPESA_CALLBACK_SECRET must be the last segment of MPESA_CALLBACK_URL.
 * Unset means console/dev, where the bare path stays reachable.
 */
const callbackSecret = process.env.MPESA_CALLBACK_SECRET ?? '';

function callbackTokenOk(token: string | undefined): boolean {
  if (!callbackSecret) return true;
  if (typeof token !== 'string' || token.length !== callbackSecret.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(callbackSecret));
}

const handleStkCallback = async (
  req: FastifyRequest<{ Params: { token?: string } }>,
  reply: FastifyReply,
) => {
  const token = req.params?.token;
  if (!callbackTokenOk(token)) {
    // Not 200: this is not Safaricom, so there is no retry to suppress,
    // and a forged confirm must never be told it looked plausible.
    app.log.warn({ ip: req.ip }, 'rejected M-Pesa callback with bad/missing token');
    return reply.code(404).send({ error: 'not found' });
  }
  const parsed = parseStkCallback(req.body);
  if (!parsed) {
    app.log.warn({ body: req.body }, 'unrecognised M-Pesa callback shape');
    return reply.code(400).send({ ok: false });
  }

  if (!parsed.succeeded) {
    app.log.info({ checkoutRequestId: parsed.checkoutRequestId, reason: parsed.resultDescription },
      'STK push not completed');
    // A cancelled or timed-out push still has to be recorded, or the
    // payer's screen spins until it gives up and the business is left
    // with a pending row and no idea whether the money is coming.
    // Donations and /pay business payments both handle their own
    // failures; store/registration/booking checkouts still silently time
    // out on their own waiting screens. That's a real gap but a separate
    // fix from what was asked for here; flagged rather than expanded into
    // silently on this pass.
    for (const [fail, code, what] of [
      [failDonationPayment, DonationError, 'donation'],
      [failBusinessPayment, BusinessPaymentError, 'business payment'],
    ] as const) {
      try {
        await fail(parsed.checkoutRequestId, parsed.resultDescription);
      } catch (e) {
        if (!(e instanceof code && e.code === 'NOT_FOUND')) {
          app.log.error({ err: e, checkoutRequestId: parsed.checkoutRequestId }, `failed to record ${what} failure`);
        }
      }
    }
    return reply.send({ ok: true }); // acknowledged — nothing to post
  }

  try {
    const order = await confirmStoreOrderPayment(parsed.checkoutRequestId, parsed.mpesaReceiptCode ?? '');
    // Best-effort, same as every other confirmer below: the order is
    // already PAID and the ledger already posted by the time we get
    // here, so an SMS provider hiccup must not fail the webhook.
    if (order.receipt?.sentTo && order.receipt.receiptCode) {
      await sendSms(
        order.receipt.sentTo,
        purchaseReceiptSms({ storeName: order.receipt.storeName ?? 'Esoqo', amountKes: Number(order.receipt.totalKes), receiptCode: order.receipt.receiptCode }),
        'purchase-receipt',
      ).catch((err) => app.log.error({ err, checkoutRequestId: parsed.checkoutRequestId }, 'failed to send order receipt SMS'));
    }
    return reply.send({ ok: true });
  } catch (e) {
    if (!(e instanceof StoreOrderError && e.code === 'NOT_FOUND')) {
      app.log.error({ err: e, checkoutRequestId: parsed.checkoutRequestId }, 'failed to confirm store order payment');
      return reply.send({ ok: true });
    }
  }

  try {
    await confirmRegistrationPaymentByCheckoutId(parsed.checkoutRequestId, parsed.mpesaReceiptCode ?? '');
    return reply.send({ ok: true });
  } catch {
    // Falls through to donation below — a registration-payment miss here
    // isn't necessarily an error, it may just belong to the third kind.
  }

  try {
    const result = await confirmDonationPayment(parsed.checkoutRequestId, parsed.mpesaReceiptCode ?? '');
    if (result.justConfirmed && result.notify) {
      const n = result.notify;
      // Best-effort — the donation itself is already confirmed and
      // posted; an SMS provider hiccup here must not fail the webhook
      // (Safaricom would just retry the whole callback).
      try {
        await sendSms(n.donorMsisdn, donorThankYouSms(n), 'donation-thank-you');
        await Promise.all(n.adminMsisdns.map((to) => sendSms(to, adminDonationAlertSms(n), 'donation-admin-alert')));
      } catch (e) {
        app.log.error({ err: e, checkoutRequestId: parsed.checkoutRequestId }, 'failed to send donation SMS notifications');
      }
    }
    return reply.send({ ok: true });
  } catch (e) {
    if (!(e instanceof DonationError && e.code === 'NOT_FOUND')) {
      // Still 200 — Safaricom retries on non-2xx, and a retry storm on
      // an already-broken match helps no one. Logged for a human.
      app.log.error({ err: e, checkoutRequestId: parsed.checkoutRequestId }, 'failed to confirm donation payment');
      return reply.send({ ok: true });
    }
  }

  // A /pay business payment: the payer's receipt and the business's
  // "you were paid" alert. Last of the TS confirmers because it is the
  // newest and the least likely to be any given callback.
  try {
    const result = await confirmBusinessPayment(parsed.checkoutRequestId, parsed.mpesaReceiptCode ?? '');
    if (result.justConfirmed && result.notify) {
      const n = result.notify;
      // Both sends are best-effort, and independent of each other: the
      // payer is told what they paid for, the business is told money
      // arrived, and neither failure should suppress the other or fail
      // the webhook. The payment is already confirmed and the ledger
      // already balanced by the time we get here.
      const results = await Promise.allSettled([
        sendSms(n.payerMsisdn, payerPaymentReceiptSms({
          amountKes: n.amountKes,
          businessName: n.businessName,
          receiptCode: n.receiptCode,
          mpesaReceiptCode: n.mpesaReceiptCode,
          receiptVerifyCode: n.receiptVerifyCode,
        }), 'business-payment-receipt'),
        ...n.businessMsisdns.map((to) => sendSms(
          to,
          businessPaymentAlertSms({
            amountKes: n.amountKes,
            businessName: n.businessName,
            receiptCode: n.receiptCode,
            mpesaReceiptCode: n.mpesaReceiptCode,
            payerMsisdn: n.payerMsisdn,
          }),
          'business-payment-alert',
        )),
      ]);
      for (const r of results) {
        if (r.status === 'rejected') {
          app.log.error({ err: r.reason, checkoutRequestId: parsed.checkoutRequestId },
            'failed to send a business payment SMS');
        }
      }
    }
    return reply.send({ ok: true });
  } catch (e) {
    if (!(e instanceof BusinessPaymentError && e.code === 'NOT_FOUND')) {
      app.log.error({ err: e, checkoutRequestId: parsed.checkoutRequestId }, 'failed to confirm business payment');
      return reply.send({ ok: true });
    }
  }

  // A personal Wallet top-up. Last of the TS confirmers, same reason as
  // business payment above — newest, least likely to match. A top-up has
  // no second party to notify (unlike business payment's receipt+alert
  // pair), but the person themselves still gets one message carrying
  // Esoqo's own reference code — the balance updating is confirmation
  // enough next time the page loads, but a code to quote support or
  // reconcile against isn't visible anywhere else until then.
  try {
    const result = await confirmWalletTopUp(parsed.checkoutRequestId, parsed.mpesaReceiptCode ?? '');
    if (result.justConfirmed && result.topUp.referenceCode) {
      const t = result.topUp;
      try {
        await sendSms(t.msisdn, walletTopUpConfirmedSms({
          amountKes: Number(t.amountKes), referenceCode: t.referenceCode!,
        }), 'wallet-topup-confirmed');
      } catch (e) {
        app.log.error({ err: e, checkoutRequestId: parsed.checkoutRequestId }, 'failed to send wallet top-up SMS');
      }
    }
    return reply.send({ ok: true });
  } catch (e) {
    if (!(e instanceof WalletTopUpError && e.code === 'NOT_FOUND')) {
      app.log.error({ err: e, checkoutRequestId: parsed.checkoutRequestId }, 'failed to confirm wallet top-up');
      return reply.send({ ok: true });
    }
  }

  // A signatory-fee STK payment (STK_NEW_SIGNER / STK_OFFICER). Last of
  // the TS confirmers, same reasoning as wallet top-up above.
  try {
    await confirmSignatoryFeePayment(parsed.checkoutRequestId, parsed.mpesaReceiptCode ?? '');
    return reply.send({ ok: true });
  } catch (e) {
    if (!(e instanceof TreasuryError && e.code === 'NOT_FOUND')) {
      app.log.error({ err: e, checkoutRequestId: parsed.checkoutRequestId }, 'failed to confirm signatory fee payment');
      return reply.send({ ok: true });
    }
  }

  // Booking and fare callbacks are confirmed by core-go (the sole
  // writer for those tables since the console migration) — forward the
  // raw body there best-effort and still 200: Go's confirms are
  // idempotent, and Safaricom must never retry a handed-off callback.
  await forwardCallbackToGo(req.body, app.log, parsed.checkoutRequestId);
  return reply.send({ ok: true });
};

// Both registered, one handler: the bare path is kept so a callback
// arriving without the secret is logged and rejected rather than 404ing
// anonymously, and so console/dev setups keep working.
app.post('/webhooks/mpesa/stk-callback', handleStkCallback);
app.post('/webhooks/mpesa/stk-callback/:token', handleStkCallback);

/**
 * Daraja's B2C result callback — a wallet withdrawal or (once enabled) a
 * third-party payout settling. Same secret-path-segment gate as the STK
 * callback above (reusing MPESA_CALLBACK_SECRET rather than a second
 * secret nobody would remember to rotate in step with the first), but a
 * different payload shape (see parseB2CResultCallback). Two possible
 * owners share this one B2C conversation-id namespace — WalletWithdrawal
 * and (once THIRDPARTY_PAYOUT_ENABLED) ThirdPartyPayout — so this tries
 * the withdrawal first and falls through to the payout only on a
 * NOT_FOUND, same "try the more common owner first" shape the STK
 * callback above already uses across its five tables.
 */
const handleB2CResultCallback = async (
  req: FastifyRequest<{ Params: { token?: string } }>,
  reply: FastifyReply,
) => {
  const token = req.params?.token;
  if (!callbackTokenOk(token)) {
    app.log.warn({ ip: req.ip }, 'rejected M-Pesa B2C callback with bad/missing token');
    return reply.code(404).send({ error: 'not found' });
  }
  const parsed = parseB2CResultCallback(req.body);
  if (!parsed) {
    app.log.warn({ body: req.body }, 'unrecognised M-Pesa B2C callback shape');
    return reply.code(400).send({ ok: false });
  }

  if (!parsed.succeeded) {
    try {
      // conversationId, not a row id: failWalletWithdrawalById expects
      // our own row id, and all this callback carries is Daraja's
      // ConversationID — resolved via the same unique column each
      // confirm function keys on.
      const withdrawal = await prisma.walletWithdrawal.findUnique({ where: { mpesaConversationId: parsed.conversationId } });
      if (withdrawal) {
        await failWalletWithdrawalById(withdrawal.id, parsed.resultDescription);
      } else {
        const payout = await prisma.thirdPartyPayout.findUnique({ where: { mpesaConversationId: parsed.conversationId } });
        if (payout) await failThirdPartyPayoutById(payout.id, parsed.resultDescription);
      }
    } catch (e) {
      app.log.error({ err: e, conversationId: parsed.conversationId }, 'failed to record B2C payout failure');
    }
    return reply.send({ ok: true });
  }

  try {
    const result = await confirmWalletWithdrawal(parsed.conversationId, parsed.mpesaTransactionId ?? '');
    if (result.justConfirmed) {
      const w = result.withdrawal;
      try {
        await sendSms(w.msisdn, walletWithdrawalConfirmedSms({
          amountKes: Number(w.amountKes), feeKes: Number(w.feeKes),
          netPayoutKes: Number(w.netPayoutKes), msisdn: w.msisdn,
          referenceCode: w.referenceCode ?? '',
        }), 'wallet-withdrawal-confirmed');
      } catch (e) {
        app.log.error({ err: e, conversationId: parsed.conversationId }, 'failed to send wallet withdrawal SMS');
      }
    }
    return reply.send({ ok: true });
  } catch (e) {
    if (!(e instanceof WalletWithdrawalError && e.code === 'NOT_FOUND')) {
      app.log.error({ err: e, conversationId: parsed.conversationId }, 'failed to confirm wallet withdrawal');
      return reply.send({ ok: true });
    }
  }

  // Dark until THIRDPARTY_PAYOUT_ENABLED flips — no route can produce a
  // conversation id here yet, so this branch is unreachable in practice,
  // but the plumbing is wired so flipping the flag doesn't also require
  // a webhook change.
  try {
    await confirmThirdPartyPayout(parsed.conversationId, parsed.mpesaTransactionId ?? '');
  } catch (e) {
    if (!(e instanceof ThirdPartyPayoutError && e.code === 'NOT_FOUND')) {
      app.log.error({ err: e, conversationId: parsed.conversationId }, 'failed to confirm third-party payout');
    }
  }
  return reply.send({ ok: true });
};

app.post('/webhooks/mpesa/b2c-result', handleB2CResultCallback);
app.post('/webhooks/mpesa/b2c-result/:token', handleB2CResultCallback);

/**
 * Daraja's B2C QueueTimeOutURL — the request itself never produced a
 * result within Safaricom's own queue window. Not a "failed" verdict any
 * more than STK's UNKNOWN is: treated as a same-shape failure here only
 * because, unlike STK (where a customer can simply be asked to try
 * again), a queued B2C request has no second, cheaper way to find out
 * what happened — so it is marked FAILED and the money stays in the
 * wallet, rather than left PENDING forever with no way to reconcile it.
 */
app.post('/webhooks/mpesa/b2c-timeout', async (req, reply) => {
  const parsed = parseB2CResultCallback(req.body);
  if (parsed) {
    try {
      const withdrawal = await prisma.walletWithdrawal.findUnique({ where: { mpesaConversationId: parsed.conversationId } });
      if (withdrawal) {
        await failWalletWithdrawalById(withdrawal.id, 'Timed out waiting for Safaricom');
      } else {
        const payout = await prisma.thirdPartyPayout.findUnique({ where: { mpesaConversationId: parsed.conversationId } });
        if (payout) await failThirdPartyPayoutById(payout.id, 'Timed out waiting for Safaricom');
      }
    } catch (e) {
      app.log.error({ err: e }, 'failed to record B2C payout timeout');
    }
  }
  return reply.send({ ok: true });
});

/**
 * Strangler bridge: during the TS→Go migration both webhook routes are
 * live and Daraja may be configured with either callback URL, so a
 * Go-owned checkout (fare, Go-initiated booking) can arrive here.
 * Forward the untouched body; never throw (caller always 200s).
 */
async function forwardCallbackToGo(
  body: unknown,
  log: { warn: (obj: unknown, msg: string) => void },
  checkoutRequestId: string,
): Promise<void> {
  const base = process.env.CORE_GO_URL ?? 'http://localhost:4100';
  try {
    const res = await fetch(`${base}/webhooks/mpesa/stk-callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) log.warn({ checkoutRequestId, status: res.status }, 'go webhook forward non-2xx');
  } catch (e) {
    log.warn({ checkoutRequestId, err: e }, 'go webhook forward failed');
  }
}

/**
 * Pesapal's IPN — unlike the M-Pesa callback above, an IPN carries only
 * the OrderTrackingId, never the payment result itself, so this always
 * calls confirmPesapalOrder (a real GetTransactionStatus round trip)
 * before trusting anything. Pesapal is currently only wired to
 * registration payments (CECF card checkout); if it's ever used for the
 * storefront/donations/ticketing too, this gains the same fall-through
 * the M-Pesa handler above uses.
 */
app.post('/webhooks/pesapal/ipn', async (req, reply) => {
  const parsed = parsePesapalIpn({ ...(req.query as object), ...(req.body as object) });
  if (!parsed) {
    app.log.warn({ query: req.query, body: req.body }, 'unrecognised Pesapal IPN shape');
    return reply.code(400).send({ ok: false });
  }

  try {
    const status = await confirmPesapalOrder(parsed.orderTrackingId);
    if (!status.succeeded) {
      app.log.info({ orderTrackingId: parsed.orderTrackingId, status: status.statusDescription }, 'Pesapal order not completed');
      return reply.send({ ok: true }); // acknowledged — nothing to post
    }
    await confirmRegistrationPaymentByPesapalOrderId(parsed.orderTrackingId);
  } catch (e) {
    // Still 200 — Pesapal retries on non-2xx, and a retry storm on an
    // already-broken match helps no one. Logged for a human.
    app.log.error({ err: e, orderTrackingId: parsed.orderTrackingId }, 'failed to confirm Pesapal registration payment');
  }
  return reply.send({ ok: true });
});

/**
 * Self-driving reconciliation in console mode — there's no cron on a
 * dev box, and requiring one to test custom domains locally is exactly
 * the kind of friction console mode exists to remove elsewhere (see
 * mpesaProvider's "auto-confirms locally", otp.ts's console
 * short-circuit). Real deploys still need the external cron in
 * docs/proposals/our-jamii-custom-domains.md — this interval is scoped
 * to console mode specifically (never `cloudflare`) so it can never
 * turn into an accidental extra poller hammering Cloudflare's API in
 * production alongside the real cron.
 */
if (jamiiDomainProvider() === 'console') {
  const RECONCILE_INTERVAL_MS = 5_000;
  setInterval(() => {
    runJamiiDomainReconcile(app.log).catch((e) => {
      app.log.error({ err: e }, 'self-driven jamii domain reconcile failed');
    });
  }, RECONCILE_INTERVAL_MS).unref();
  app.log.info({ appEnv: appEnv() }, 'jamii domains: self-driven reconcile loop running (console mode)');
}

/**
 * The contribution-gap digest — real cadence, not console-gated like
 * the reconcile loop above, because it has nothing to protect
 * production from: it only ever reads confirmed contributions and
 * sends an SMS, the same side effect it would have running from an
 * external cron. Once a day is plenty; a group's quiet streak doesn't
 * change meaningfully more often than that. See jobs/group-alerts.ts
 * for why this can run frequently without risking a duplicate text.
 */
const DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;
// setInterval alone only fires *after* the first full interval elapses —
// on a platform that restarts the process on every deploy (routine here),
// a 24h timer can go a long time without ever completing one full run,
// so the digest silently never sends. Idempotent by day-count match (see
// this function's own comment), so an immediate run at boot is safe.
runContributionGapDigest(app.log).catch((e) => {
  app.log.error({ err: e }, 'contribution-gap digest failed');
});
setInterval(() => {
  runContributionGapDigest(app.log).catch((e) => {
    app.log.error({ err: e }, 'contribution-gap digest failed');
  });
}, DIGEST_INTERVAL_MS).unref();

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`core service on :${port}`);
