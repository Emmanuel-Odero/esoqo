/**
 * Cloudflare for SaaS — Custom Hostnames client.
 *
 * Gated exactly the way MPESA_PROVIDER gates Daraja in
 * @esoqo/payments/src/mpesa.ts and SMS_PROVIDER gates OTP delivery in
 * @esoqo/auth/src/sms.ts: JAMII_DOMAIN_PROVIDER=console|cloudflare,
 * default `console`. Console mode never calls Cloudflare or real DNS —
 * it logs what it would have done and simulates an immediately-healthy
 * hostname, so the whole request -> reconcile -> ACTIVE -> serve flow
 * is testable on a dev box with no Cloudflare account, no owned domain,
 * and no real DNS record. `cloudflare` calls the real API and does a
 * real DNS lookup for the ownership TXT record — flipping to it is the
 * deliberate, reviewed step that starts pointing real hostnames at us.
 *
 * Unlike M-Pesa (which has a genuine `sandbox` — Safaricom's own test
 * environment, safe from any run mode), Cloudflare for SaaS has no
 * comparable safe-real-vendor mode: it's either simulated locally or
 * it's the real zone. So there are only two levels here, and — same
 * guard as mpesaProvider's `production` — an explicit
 * JAMII_DOMAIN_PROVIDER=cloudflare is never honoured from a plain
 * `development` box, only from LOCAL_TEST_PROD or a real `production`
 * deploy.
 *
 * The API token this holds (CLOUDFLARE_API_TOKEN) can point arbitrary
 * hostnames at us — it lives only here, in the core plane, never in
 * apps/jamii or the browser. See
 * packages/db/src/dal/jamii-domain.ts's file header.
 */

import { resolveTxt } from 'node:dns/promises';
import { appEnv } from '@esoqo/domain';

const API_BASE = 'https://api.cloudflare.com/client/v4';

export function jamiiDomainProvider(): 'console' | 'cloudflare' {
  const raw = process.env.JAMII_DOMAIN_PROVIDER;
  if (raw === 'cloudflare') {
    return appEnv() === 'development' ? 'console' : 'cloudflare';
  }
  return 'console';
}

export class CloudflareError extends Error {
  constructor(
    msg: string,
    public readonly status: number,
  ) {
    super(msg);
    this.name = 'CloudflareError';
  }
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

async function cf<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env('CLOUDFLARE_API_TOKEN')}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const message = body?.errors?.[0]?.message ?? `Cloudflare API error (${res.status})`;
    throw new CloudflareError(message, res.status);
  }
  return body.result as T;
}

export interface CustomHostnameResult {
  cfHostnameId: string;
  /** Raw Cloudflare status — 'pending' | 'active' | 'active_redeploying'
   *  | 'moved' | 'pending_deletion' | 'deleted' | 'pending_blocked' |
   *  'pending_migration' | 'pending_provisioned' | 'test_pending' |
   *  'test_active' | 'test_active_apex' | 'test_blocked' |
   *  'test_failed' | 'provisioned' | 'blocked'. In console mode this is
   *  always 'active'. */
  status: string;
  sslStatus: string;
  /** Our own second proof of control is a separate TXT record (see
   *  requestJamiiDomain's verificationToken); this is Cloudflare's own
   *  ownership-verification record, shown alongside it. Always null in
   *  console mode — there's nothing real to show. */
  ownershipTxt: { name: string; value: string } | null;
}

function normalise(raw: any): CustomHostnameResult {
  return {
    cfHostnameId: raw.id,
    status: raw.status,
    sslStatus: raw.ssl?.status ?? 'unknown',
    ownershipTxt: raw.ownership_verification?.type === 'txt'
      ? { name: raw.ownership_verification.name, value: raw.ownership_verification.value }
      : null,
  };
}

/**
 * Registers the hostname with Cloudflare so it can be verified and
 * issued a certificate. Cloudflare separately requires the domain's own
 * DNS to CNAME to CLOUDFLARE_FALLBACK_ORIGIN before it will ever report
 * 'active' — that instruction is shown to the group by the dashboard,
 * not enforced here.
 */
export async function createCustomHostname(hostname: string): Promise<CustomHostnameResult> {
  if (jamiiDomainProvider() === 'console') {
    console.log(`\n  ┌─ Jamii domain (console) ────────────\n  │  would register with Cloudflare: ${hostname}\n  │  simulating an immediately-healthy hostname —\n  │  no real Cloudflare call, no real DNS lookup\n  └───────────────────────────────────\n`);
    return { cfHostnameId: `console-${hostname}`, status: 'active', sslStatus: 'active', ownershipTxt: null };
  }

  const zoneId = env('CLOUDFLARE_ZONE_ID');
  const raw = await cf<any>(`/zones/${zoneId}/custom_hostnames`, {
    method: 'POST',
    body: JSON.stringify({
      hostname,
      ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } },
    }),
  });
  return normalise(raw);
}

export async function getCustomHostnameStatus(cfHostnameId: string): Promise<CustomHostnameResult> {
  if (jamiiDomainProvider() === 'console') {
    return { cfHostnameId, status: 'active', sslStatus: 'active', ownershipTxt: null };
  }

  const zoneId = env('CLOUDFLARE_ZONE_ID');
  const raw = await cf<any>(`/zones/${zoneId}/custom_hostnames/${cfHostnameId}`);
  return normalise(raw);
}

/** Idempotent — a hostname already gone (404) is treated as success so
 *  the reconciler's teardown step can't get stuck retrying forever. */
export async function deleteCustomHostname(cfHostnameId: string): Promise<void> {
  if (jamiiDomainProvider() === 'console') {
    console.log(`  [Jamii domain (console)] would delete Cloudflare hostname ${cfHostnameId}`);
    return;
  }

  const zoneId = env('CLOUDFLARE_ZONE_ID');
  try {
    await cf<any>(`/zones/${zoneId}/custom_hostnames/${cfHostnameId}`, { method: 'DELETE' });
  } catch (e) {
    if (e instanceof CloudflareError && e.status === 404) return;
    throw e;
  }
}

/**
 * Our own proof of control, independent of Cloudflare's — a domain
 * never reaches ACTIVE on Cloudflare's say-so alone (see
 * routes/jamii-domains.ts). DNS not having propagated yet is the
 * common case and isn't a failure, just "not yet".
 *
 * Console mode short-circuits to true: there's no real DNS to check for
 * a `.localtest.me`/made-up local hostname, and requiring one would
 * make the whole feature untestable without owning a real domain —
 * the same reasoning MPESA_PROVIDER=console auto-confirms a payment
 * instead of waiting on a callback that will never arrive.
 *
 * Both record names are accepted. `_esoko-verify` is what every org
 * that verified before the Esoqo rename published at their own
 * registrar, and those records are not ours to re-cut — an org that
 * already passed must not silently fail its next re-check. New setups
 * are told to use `_esoqo-verify` (see DomainPanel).
 */
export const VERIFY_TXT_PREFIXES = ['_esoqo-verify', '_esoko-verify'] as const;

export async function verifyOwnershipTxt(hostname: string, token: string): Promise<boolean> {
  if (jamiiDomainProvider() === 'console') return true;

  for (const prefix of VERIFY_TXT_PREFIXES) {
    try {
      const records = await resolveTxt(`${prefix}.${hostname}`);
      if (records.some((chunks) => chunks.join('') === token)) return true;
    } catch {
      // NXDOMAIN on one name just means try the other.
    }
  }
  return false;
}
