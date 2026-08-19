/**
 * Pesapal (hosted card checkout) integration.
 *
 * Same shape and same gating discipline as mpesa.ts, deliberately:
 * PESAPAL_PROVIDER=console|sandbox|production, default `console`. Console
 * mode never calls Pesapal — it logs the order and auto-confirms locally,
 * so a card checkout is fully testable without live credentials.
 * `production` calls the real Pesapal API — flipping PESAPAL_PROVIDER to
 * it in a deployed environment is the deliberate, reviewed step that
 * starts moving real money, not a default path (development is hardcoded
 * to console regardless — see pesapalProvider() and mpesaProvider()'s own
 * comment for the full reasoning, identical here).
 *
 * Unlike an M-Pesa STK push, a Pesapal order alone tells you nothing about
 * whether it was paid — the redirect to Pesapal's hosted page, and later
 * the IPN notification, both only carry an OrderTrackingId. The actual
 * result has to be fetched separately via GetTransactionStatus, so this
 * module splits that into two steps: parsePesapalIpn (sync, just extracts
 * the identifiers) and confirmPesapalOrder (async, calls Pesapal to find
 * out what actually happened) — see services/core's
 * /webhooks/pesapal/ipn route, which calls both in sequence.
 *
 * Deliberately no `server-only` marker, for the same reason as mpesa.ts:
 * called from both Next.js Server Actions/API routes and services/core's
 * plain-Node webhook handler.
 */

import { appEnv } from '@esoko/domain';

const SANDBOX_BASE = 'https://cybqa.pesapal.com/pesapalv3';
const PRODUCTION_BASE = 'https://pay.pesapal.com/v3';

export function pesapalProvider(): 'console' | 'sandbox' | 'production' {
  const raw = process.env.PESAPAL_PROVIDER;
  const requested = raw === 'live' ? 'production' : raw;

  if (requested === 'sandbox') return 'sandbox'; // test money only — safe in any run mode

  if (requested === 'production') {
    // Real money. Never from a plain development box, no matter what
    // this env var says.
    return appEnv() === 'development' ? 'console' : 'production';
  }

  if (appEnv() === 'development') return 'console';
  return appEnv() === 'LOCAL_TEST_PROD' ? 'sandbox' : 'console';
}

const PROVIDER = pesapalProvider();

export class PesapalError extends Error {
  constructor(
    msg: string,
    public readonly code: 'INVALID_REQUEST' | 'PESAPAL_ERROR' | 'NOT_CONFIGURED',
  ) {
    super(msg);
    this.name = 'PesapalError';
  }
}

export interface PesapalOrderRequest {
  merchantReference: string; // our own id — RegistrationPayment.id is used by callers
  amountKes: number;
  description: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  /** Where Pesapal sends the browser back to once checkout finishes. */
  returnUrl: string;
}

export interface PesapalOrderResult {
  orderTrackingId: string;
  merchantReference: string;
  /** The browser is redirected here for the hosted card page. */
  redirectUrl: string;
  /** True when this call already confirmed the payment (console mode only). */
  autoConfirmed: boolean;
}

export async function initiatePesapalOrder(req: PesapalOrderRequest): Promise<PesapalOrderResult> {
  if (!req.merchantReference?.trim()) {
    throw new PesapalError('A merchant reference is required', 'INVALID_REQUEST');
  }

  if (PROVIDER === 'console') {
    // Mimics the round trip to Pesapal and back so the UI's "redirecting
    // to card checkout" state is exercised honestly instead of resolving
    // instantly.
    await new Promise((r) => setTimeout(r, 800));
    const orderTrackingId = `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(
      `\n  ┌─ PESAPAL ORDER (console) ──────────\n` +
      `  │  ${req.merchantReference}\n` +
      `  │  KES ${req.amountKes.toLocaleString('en-KE')} — ${req.description}\n` +
      `  │  orderTrackingId: ${orderTrackingId}\n` +
      `  │  auto-confirmed (never enabled in a deployed environment)\n` +
      `  └─────────────────────────────────────\n`,
    );
    return {
      orderTrackingId,
      merchantReference: req.merchantReference,
      redirectUrl: `${req.returnUrl}?console=1&orderTrackingId=${orderTrackingId}`,
      autoConfirmed: true,
    };
  }

  if (PROVIDER === 'sandbox') return submitPesapalOrder(req, SANDBOX_BASE);

  // PROVIDER === 'production' — same submit call as sandbox, against
  // Pesapal's live base URL. Real money moves the moment the registrant
  // completes checkout, so this only ever runs where pesapalProvider()
  // allows it: never in development, and in a deployed environment only
  // once PESAPAL_PROVIDER is deliberately set to "production" there.
  return submitPesapalOrder(req, PRODUCTION_BASE);
}

/* ── real Pesapal API calls — same shape for sandbox and production,
 *    only the base URL and the credentials behind it differ ──────── */

async function getPesapalAccessToken(base: string): Promise<string> {
  const key = process.env.PESAPAL_CONSUMER_KEY;
  const secret = process.env.PESAPAL_CONSUMER_SECRET;
  if (!key || !secret) {
    throw new PesapalError('PESAPAL_CONSUMER_KEY/PESAPAL_CONSUMER_SECRET are not set', 'NOT_CONFIGURED');
  }
  const res = await fetch(`${base}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ consumer_key: key, consumer_secret: secret }),
  });
  const data = (await res.json()) as { token?: string; error?: unknown; message?: string };
  if (!res.ok || !data.token) {
    throw new PesapalError(data.message ?? 'Could not authenticate with Pesapal', 'PESAPAL_ERROR');
  }
  return data.token;
}

async function submitPesapalOrder(req: PesapalOrderRequest, base: string): Promise<PesapalOrderResult> {
  const notificationId = process.env.PESAPAL_IPN_ID;
  if (!notificationId) {
    // A Pesapal IPN URL is registered once (via Pesapal's URLSetup/
    // RegisterIPN call, run as a one-off setup step, not per-request) and
    // the resulting ipn_id is a static credential from then on — same
    // role as MPESA_SHORTCODE below.
    throw new PesapalError('PESAPAL_IPN_ID is not set — register the IPN URL with Pesapal first', 'NOT_CONFIGURED');
  }

  const token = await getPesapalAccessToken(base);

  const res = await fetch(`${base}/api/Transactions/SubmitOrderRequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      id: req.merchantReference,
      currency: 'KES',
      amount: Math.round(req.amountKes),
      description: req.description.slice(0, 100),
      callback_url: req.returnUrl,
      notification_id: notificationId,
      billing_address: {
        email_address: req.email || undefined,
        phone_number: req.phone || undefined,
        first_name: req.firstName || undefined,
        last_name: req.lastName || undefined,
        country_code: 'KE',
      },
    }),
  });

  const data = (await res.json()) as {
    order_tracking_id?: string;
    merchant_reference?: string;
    redirect_url?: string;
    error?: { message?: string } | null;
  };
  if (!res.ok || !data.order_tracking_id || !data.redirect_url) {
    throw new PesapalError(data.error?.message ?? 'Pesapal rejected the order request', 'PESAPAL_ERROR');
  }

  return {
    orderTrackingId: data.order_tracking_id,
    merchantReference: data.merchant_reference ?? req.merchantReference,
    redirectUrl: data.redirect_url,
    autoConfirmed: false,
  };
}

/* ── IPN handling, used by services/core's webhook route ──────────── */

export interface PesapalIpnResult {
  orderTrackingId: string;
  merchantReference: string;
}

/**
 * Pure parsing only — an IPN notification carries just the identifiers,
 * never the payment result itself. Accepts either query params (Pesapal
 * v3's default GET IPN) or a JSON body (if registered as POST).
 */
export function parsePesapalIpn(source: unknown): PesapalIpnResult | null {
  const q = source as Record<string, unknown> | null | undefined;
  const orderTrackingId = q?.OrderTrackingId ?? q?.orderTrackingId;
  const merchantReference = q?.OrderMerchantReference ?? q?.orderMerchantReference;
  if (typeof orderTrackingId !== 'string' || !orderTrackingId) return null;
  return {
    orderTrackingId,
    merchantReference: typeof merchantReference === 'string' ? merchantReference : '',
  };
}

export interface PesapalConfirmResult {
  succeeded: boolean;
  statusDescription: string;
}

/** The real confirmation step — call after parsePesapalIpn, never trust
 *  the IPN payload's own claims about payment status. */
export async function confirmPesapalOrder(orderTrackingId: string): Promise<PesapalConfirmResult> {
  const provider = PROVIDER;
  if (provider === 'console') {
    return { succeeded: true, statusDescription: 'COMPLETED (console)' };
  }
  const base = provider === 'sandbox' ? SANDBOX_BASE : PRODUCTION_BASE;
  const token = await getPesapalAccessToken(base);
  const res = await fetch(
    `${base}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
  );
  const data = (await res.json()) as { payment_status_description?: string; status_code?: number };
  const description = data.payment_status_description ?? 'UNKNOWN';
  return { succeeded: description.toUpperCase() === 'COMPLETED', statusDescription: description };
}
