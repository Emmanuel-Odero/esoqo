import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import {
  verifyChain, confirmStoreOrderPayment, confirmRegistrationPaymentByCheckoutId,
  confirmRegistrationPaymentByPesapalOrderId,
  confirmDonationPayment, confirmBookingPayment, StoreOrderError, DonationError, TicketingError,
} from '@esoko/db';
import { parseStkCallback, parsePesapalIpn, confirmPesapalOrder } from '@esoko/payments';
import { cecfRoutes } from './routes/cecf';

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

app.get('/health', async () => ({ ok: true, service: 'core', ts: new Date().toISOString() }));

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
 * A single checkout can only ever belong to one of four things — store
 * checkout, a registration fee, an Our Jamii donation, or a ticketing
 * booking — so this tries the store order first (the most established
 * of the four) and falls through to registration, then donation, then
 * booking, only on a NOT_FOUND from the attempt before it. Any other
 * failure from an attempt is a real error, not "try the next kind."
 */
app.post('/webhooks/mpesa/stk-callback', async (req, reply) => {
  const parsed = parseStkCallback(req.body);
  if (!parsed) {
    app.log.warn({ body: req.body }, 'unrecognised M-Pesa callback shape');
    return reply.code(400).send({ ok: false });
  }

  if (!parsed.succeeded) {
    app.log.info({ checkoutRequestId: parsed.checkoutRequestId, reason: parsed.resultDescription },
      'STK push not completed');
    return reply.send({ ok: true }); // acknowledged — nothing to post
  }

  try {
    await confirmStoreOrderPayment(parsed.checkoutRequestId, parsed.mpesaReceiptCode ?? '');
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
    await confirmDonationPayment(parsed.checkoutRequestId, parsed.mpesaReceiptCode ?? '');
    return reply.send({ ok: true });
  } catch (e) {
    if (!(e instanceof DonationError && e.code === 'NOT_FOUND')) {
      // Still 200 — Safaricom retries on non-2xx, and a retry storm on
      // an already-broken match helps no one. Logged for a human.
      app.log.error({ err: e, checkoutRequestId: parsed.checkoutRequestId }, 'failed to confirm donation payment');
      return reply.send({ ok: true });
    }
  }

  try {
    await confirmBookingPayment(parsed.checkoutRequestId);
  } catch (e) {
    if (!(e instanceof TicketingError && e.code === 'NOT_FOUND')) {
      app.log.error({ err: e, checkoutRequestId: parsed.checkoutRequestId }, 'failed to confirm booking payment');
    }
  }
  return reply.send({ ok: true });
});

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

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`core service on :${port}`);
