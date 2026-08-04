import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { verifyChain, confirmStoreOrderPayment } from '@esoko/db';
import { parseStkCallback } from '@esoko/payments';

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
 * endpoint" the store checkout flow needs, and the first genuine
 * consumer of this service beyond /health and /ready.
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
  } catch (e) {
    // Still 200 — Safaricom retries on non-2xx, and a retry storm on an
    // already-broken match helps no one. The error is logged for a human.
    app.log.error({ err: e, checkoutRequestId: parsed.checkoutRequestId }, 'failed to confirm store order payment');
  }
  return reply.send({ ok: true });
});

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`core service on :${port}`);
