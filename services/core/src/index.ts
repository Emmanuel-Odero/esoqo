import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { verifyChain } from '@esoko/db';

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

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`core service on :${port}`);
