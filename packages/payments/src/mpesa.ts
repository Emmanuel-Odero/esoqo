/**
 * M-Pesa Daraja integration.
 *
 * Gated exactly the way SMS_PROVIDER gates OTP delivery in
 * packages/auth/src/otp.ts: MPESA_PROVIDER=console|sandbox|production,
 * default `console`. Console mode never calls Safaricom — it logs the
 * push and auto-confirms locally, so checkout is fully testable without
 * live credentials. `production` is intentionally unimplemented here;
 * flipping this on is a deliberate, reviewed change, not a default path.
 *
 * Deliberately no `server-only` marker — this module is called both
 * from Next.js Server Actions and from services/core's plain-Node
 * webhook handler, and `server-only` throws unconditionally outside a
 * Next.js server-component bundling context.
 */

const PROVIDER = process.env.MPESA_PROVIDER ?? 'console';
const SANDBOX_BASE = 'https://sandbox.safaricom.co.ke';

export class MpesaError extends Error {
  constructor(
    msg: string,
    public readonly code: 'INVALID_MSISDN' | 'DARAJA_ERROR' | 'NOT_CONFIGURED',
  ) {
    super(msg);
    this.name = 'MpesaError';
  }
}

function assertValidMsisdn(msisdn: string) {
  // Safaricom (07/01), Airtel and Telkom ranges — same shape the OTP
  // sender validates against in packages/auth.
  if (!/^\+254(7|1)\d{8}$/.test(msisdn)) {
    throw new MpesaError('That does not look like a Kenyan mobile number', 'INVALID_MSISDN');
  }
}

export interface StkPushRequest {
  msisdn: string; // E.164, e.g. +254712345678
  amountKes: number;
  accountReference: string; // shown on the customer's phone prompt
  description: string;
}

export interface StkPushResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  responseDescription: string;
  /** True when this call already confirmed the payment (console mode only). */
  autoConfirmed: boolean;
  mpesaReceiptCode?: string;
}

export async function initiateStkPush(req: StkPushRequest): Promise<StkPushResult> {
  assertValidMsisdn(req.msisdn);

  if (PROVIDER === 'console') {
    // Mimics the ~1.5s round trip a real STK push takes to reach the
    // phone and be approved, so the UI's waiting state is exercised
    // honestly instead of resolving instantly.
    await new Promise((r) => setTimeout(r, 1500));
    const checkoutRequestId = `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const receipt = `CNS${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
    console.log(
      `\n  ┌─ M-PESA STK PUSH (console) ────────\n` +
      `  │  ${req.msisdn}\n` +
      `  │  KES ${req.amountKes.toLocaleString('en-KE')} — ${req.accountReference}\n` +
      `  │  checkoutRequestId: ${checkoutRequestId}\n` +
      `  │  auto-confirmed with receipt ${receipt}\n` +
      `  └─────────────────────────────────────\n`,
    );
    return {
      checkoutRequestId,
      merchantRequestId: checkoutRequestId,
      responseDescription: 'Accepted (console — never enabled in a deployed environment)',
      autoConfirmed: true,
      mpesaReceiptCode: receipt,
    };
  }

  if (PROVIDER === 'sandbox') {
    return initiateDarajaStkPush(req, SANDBOX_BASE);
  }

  throw new MpesaError(
    `MPESA_PROVIDER="${PROVIDER}" is not implemented — this pass only wires console and sandbox`,
    'NOT_CONFIGURED',
  );
}

/* ── real Daraja sandbox calls ────────────────────────────────── */

async function getDarajaAccessToken(base: string): Promise<string> {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) {
    throw new MpesaError('MPESA_CONSUMER_KEY/MPESA_CONSUMER_SECRET are not set', 'NOT_CONFIGURED');
  }
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  const res = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new MpesaError('Could not authenticate with Daraja', 'DARAJA_ERROR');
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function darajaTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function initiateDarajaStkPush(req: StkPushRequest, base: string): Promise<StkPushResult> {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const callbackUrl = process.env.MPESA_CALLBACK_URL;
  if (!shortcode || !passkey || !callbackUrl) {
    throw new MpesaError(
      'MPESA_SHORTCODE/MPESA_PASSKEY/MPESA_CALLBACK_URL are not set',
      'NOT_CONFIGURED',
    );
  }

  const token = await getDarajaAccessToken(base);
  const timestamp = darajaTimestamp();
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  const msisdnLocal = req.msisdn.replace('+', '');

  const res = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(req.amountKes),
      PartyA: msisdnLocal,
      PartyB: shortcode,
      PhoneNumber: msisdnLocal,
      CallBackURL: callbackUrl,
      AccountReference: req.accountReference.slice(0, 12),
      TransactionDesc: req.description.slice(0, 13),
    }),
  });

  const data = (await res.json()) as {
    CheckoutRequestID?: string;
    MerchantRequestID?: string;
    ResponseDescription?: string;
    errorMessage?: string;
  };
  if (!res.ok || !data.CheckoutRequestID) {
    throw new MpesaError(data.errorMessage ?? 'Daraja rejected the STK push request', 'DARAJA_ERROR');
  }

  return {
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID ?? data.CheckoutRequestID,
    responseDescription: data.ResponseDescription ?? 'Accepted',
    autoConfirmed: false,
  };
}

/* ── callback payload parsing, used by services/core's webhook route ── */

export interface StkCallbackResult {
  checkoutRequestId: string;
  succeeded: boolean;
  resultDescription: string;
  mpesaReceiptCode?: string;
}

export function parseStkCallback(body: unknown): StkCallbackResult | null {
  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== 'string') return null;

  const items = (cb.CallbackMetadata as { Item?: { Name: string; Value: unknown }[] } | undefined)?.Item ?? [];
  const receipt = items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value;

  return {
    checkoutRequestId: cb.CheckoutRequestID,
    succeeded: cb.ResultCode === 0,
    resultDescription: String(cb.ResultDesc ?? ''),
    mpesaReceiptCode: typeof receipt === 'string' ? receipt : undefined,
  };
}
