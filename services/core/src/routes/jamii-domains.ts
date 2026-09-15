import { timingSafeEqual } from 'node:crypto';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listDomainsNeedingReconciliation, markDomainVerifying, markDomainActive,
  markDomainFailed, touchDomainCheck, finaliseRemovedDomain,
} from '@esoqo/db';
import {
  createCustomHostname, getCustomHostnameStatus, deleteCustomHostname, verifyOwnershipTxt, CloudflareError,
} from '../lib/cloudflare-saas';

/**
 * Drives every JamiiDomain through PENDING_DNS -> VERIFYING ->
 * ACTIVE/FAILED, and tears down removed domains.
 *
 * In production this is called by an external cron (Coolify scheduled
 * job / GitHub Action — see docs/proposals/our-jamii-custom-domains.md)
 * every few minutes, over the authenticated /internal/jamii-domains/
 * reconcile route below. In development it's ALSO called on a short
 * internal interval (see index.ts) so requesting a domain locally in
 * console mode (packages/db's dal/jamii-domain.ts / cloudflare-saas.ts)
 * finishes on its own in seconds — no cron exists on a dev box, and
 * making local testing depend on remembering to curl the endpoint
 * yourself is exactly the kind of friction console mode exists to
 * remove elsewhere (see mpesaProvider's "auto-confirms locally").
 */

/** How long a domain may sit in PENDING_DNS/VERIFYING before it's
 *  treated as abandoned — matches the reclaim window
 *  packages/db/src/dal/jamii-domain.ts uses to let another page claim
 *  the same hostname. */
const STALL_TIMEOUT_MS = 14 * 24 * 60 * 60 * 1000;

const CF_TERMINAL_FAILURE = new Set(['blocked', 'test_blocked', 'test_failed']);

export interface ReconcileResult { hostname: string; outcome: string }

/** The reconciler itself — no HTTP, no auth, callable from the route
 *  handler and from index.ts's internal dev-mode interval alike. */
export async function runJamiiDomainReconcile(log: Pick<FastifyBaseLogger, 'error'>): Promise<ReconcileResult[]> {
  const domains = await listDomainsNeedingReconciliation();
  const results: ReconcileResult[] = [];

  for (const domain of domains) {
    try {
      // Removal takes priority — a group asking us to stop serving a
      // domain should never get delayed behind its own verification.
      if (domain.removedAt) {
        if (domain.cfHostnameId) await deleteCustomHostname(domain.cfHostnameId);
        await finaliseRemovedDomain(domain.id);
        results.push({ hostname: domain.hostname, outcome: 'torn_down' });
        continue;
      }

      const stale = Date.now() - domain.createdAt.getTime() > STALL_TIMEOUT_MS;

      if (domain.status === 'PENDING_DNS' && !domain.cfHostnameId) {
        const cf = await createCustomHostname(domain.hostname);
        await markDomainVerifying(domain.id, cf.cfHostnameId, cf.status);
        results.push({ hostname: domain.hostname, outcome: 'hostname_created' });
        continue;
      }

      if (domain.cfHostnameId) {
        const cf = await getCustomHostnameStatus(domain.cfHostnameId);

        if (CF_TERMINAL_FAILURE.has(cf.status)) {
          await markDomainFailed(domain.id, `Cloudflare reported "${cf.status}"`, cf.status);
          results.push({ hostname: domain.hostname, outcome: 'failed' });
          continue;
        }

        const cfReady = cf.status === 'active' && (cf.sslStatus === 'active' || cf.sslStatus === 'active_redeploying');
        if (cfReady) {
          const provenByUs = await verifyOwnershipTxt(domain.hostname, domain.verificationToken);
          if (provenByUs) {
            await markDomainActive(domain.id, cf.status);
            results.push({ hostname: domain.hostname, outcome: 'activated' });
            continue;
          }
          // Cloudflare is satisfied but our own TXT proof hasn't been
          // seen yet — hold at VERIFYING rather than trusting one
          // vendor's check alone.
        }

        if (stale) {
          await markDomainFailed(domain.id, 'Verification did not complete in time', cf.status);
          results.push({ hostname: domain.hostname, outcome: 'timed_out' });
          continue;
        }

        await touchDomainCheck(domain.id, cf.status);
        results.push({ hostname: domain.hostname, outcome: 'still_pending' });
        continue;
      }

      // PENDING_DNS with no cfHostnameId ever ran the create branch
      // above; anything else falling through here is stale with no
      // Cloudflare state to check against.
      if (stale) {
        await markDomainFailed(domain.id, 'Verification did not complete in time');
        results.push({ hostname: domain.hostname, outcome: 'timed_out' });
      }
    } catch (e) {
      log.error({ err: e, hostname: domain.hostname }, 'jamii domain reconcile step failed');
      if (e instanceof CloudflareError) {
        results.push({ hostname: domain.hostname, outcome: `cloudflare_error:${e.status}` });
      } else {
        results.push({ hostname: domain.hostname, outcome: 'error' });
      }
      // One domain's failure never blocks the rest of the batch.
    }
  }

  return results;
}

/**
 * No browser or session ever calls this — it's authenticated by a
 * single shared secret, the same "no session to trust" reasoning
 * cecf.ts uses for the WordPress ingest routes, just without a body to
 * sign since this call carries no meaningful payload.
 */
function verifyReconcileAuth(req: FastifyRequest): boolean {
  const secret = process.env.JAMII_DOMAIN_RECONCILE_SECRET;
  if (!secret) return false; // never open the door because setup was skipped

  const provided = req.headers['x-reconcile-secret'];
  if (typeof provided !== 'string' || !provided) return false;

  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function jamiiDomainsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyReconcileAuth(req)) {
      return reply.code(401).send({ ok: false, error: 'Invalid or missing reconcile secret' });
    }
  });

  app.post('/internal/jamii-domains/reconcile', async (req, reply) => {
    const results = await runJamiiDomainReconcile(req.log);
    return reply.send({ ok: true, processed: results.length, results });
  });
}
