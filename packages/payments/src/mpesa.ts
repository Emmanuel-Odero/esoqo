/**
 * M-Pesa Daraja integration.
 *
 * Gated exactly the way SMS_PROVIDER gates OTP delivery in
 * packages/auth/src/otp.ts: MPESA_PROVIDER=console|sandbox|production,
 * default `console`. Console mode never calls Safaricom — it logs the
 * push and auto-confirms locally, so checkout is fully testable without
 * live credentials. `production` calls the real Daraja API —
 * flipping MPESA_PROVIDER to it in a deployed environment is the
 * deliberate, reviewed step that starts moving real money, not a
 * default path (development is hardcoded to console regardless, below).
 *
 * The run mode (APP_ENV — see packages/domain/src/env.ts) mostly decides
 * the effective provider, but the two real risks here are independent
 * and are guarded separately:
 *   · real DATA (which database gets hit) — guarded entirely in
 *     packages/db/src/client.ts; APP_ENV=development refuses to run
 *     against a non-local DATABASE_URL, full stop.
 *   · real MONEY (does an STK push reach the live Daraja API) — guarded
 *     here: `sandbox` moves test money only, so it is honoured whenever
 *     it's explicitly requested, even from a plain development box —
 *     that lets you rehearse checkouts locally without route through
 *     LOCAL_TEST_PROD's production-database switch. `production` is
 *     never honoured from `development`, no matter what MPESA_PROVIDER
 *     says — only a genuine `production` deploy or a deliberate
 *     LOCAL_TEST_PROD rehearsal may reach Safaricom's live API. With no
 *     explicit MPESA_PROVIDER, development defaults to console and
 *     LOCAL_TEST_PROD defaults to sandbox.
 *
 * Deliberately no `server-only` marker — this module is called both
 * from Next.js Server Actions and from services/core's plain-Node
 * webhook handler, and `server-only` throws unconditionally outside a
 * Next.js server-component bundling context.
 */

import { appEnv } from '@esoqo/domain';
import { buildSecurityCredential } from './b2c-credential';

const SANDBOX_BASE = 'https://sandbox.safaricom.co.ke';
const PRODUCTION_BASE = 'https://api.safaricom.co.ke';

export function mpesaProvider(): 'console' | 'sandbox' | 'production' {
  const raw = process.env.MPESA_PROVIDER;
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

export type MpesaErrorCode = 'INVALID_MSISDN' | 'DARAJA_ERROR' | 'NOT_CONFIGURED';

export class MpesaError extends Error {
  // Assigned in the body rather than as a constructor parameter property:
  // `public readonly code` is TypeScript-only syntax that node's
  // strip-only type removal cannot handle, and this package's tests run on
  // plain `node --test`. Erasable syntax only, so the tests can exercise
  // the real module instead of a stand-in.
  readonly code: MpesaErrorCode;

  constructor(msg: string, code: MpesaErrorCode) {
    super(msg);
    this.name = 'MpesaError';
    this.code = code;
  }
}

/**
 * Daraja's JSON, read the way a network actually delivers it.
 *
 * `res.json()` is the wrong tool here, and not by a small margin: a
 * gateway 502, a corporate proxy, a captive portal or an ngrok interstitial
 * all answer with HTML, and `res.json()` answers a SyntaxError. That is
 * not an MpesaError, so it sails straight past the provider's own error
 * handling and lands in the caller's generic "we could not start that
 * payment" — which is what you get when Daraja is perfectly healthy and
 * the real cause is a proxy three hops away.
 *
 * So the status and a snippet of whatever came back always survive into
 * the error, and a non-2xx is reported as Daraja's own answer rather than
 * as a parse failure. The snippet is collapsed and length-capped because
 * this message can reach a customer.
 */
async function readDarajaJson(res: Response, what: string): Promise<Record<string, unknown>> {
  const text = await res.text().catch(() => '');
  const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 180);
  let data: Record<string, unknown>;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new MpesaError(
      `Safaricom returned ${res.status} ${res.statusText || ''} for ${what}, not JSON`
        + `${snippet ? `: ${snippet}` : ' (empty body)'}`
        + '. That usually means a proxy or gateway in front of the request.',
      'DARAJA_ERROR',
    );
  }
  if (!res.ok) {
    const said = data.errorMessage ?? data.ResponseDescription ?? data.CustomerMessage;
    throw new MpesaError(
      said ? String(said) : `Safaricom refused the ${what} (HTTP ${res.status})`,
      'DARAJA_ERROR',
    );
  }
  return data;
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

  // Resolved per call, not once at module load. A module-level constant
  // here is a switch nobody can see: edit MPESA_PROVIDER in .env, and a
  // server that is already running keeps the old mode in memory and
  // carries on quietly. The dangerous direction is a box left on console
  // after being switched to sandbox — every payment auto-confirms,
  // nothing reaches Safaricom, and the day looks successful.
  const provider = mpesaProvider();

  if (provider === 'console') {
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

  if (provider === 'sandbox') {
    return initiateDarajaStkPush(req, SANDBOX_BASE);
  }

  // provider === 'production' — same Daraja STK push call as sandbox,
  // against Safaricom's live base URL. Real money moves the moment this
  // succeeds, so it only ever runs where mpesaProvider() allows it:
  // never in development, and in a deployed environment only once
  // MPESA_PROVIDER is deliberately set to "production" there.
  return initiateDarajaStkPush(req, PRODUCTION_BASE);
}

/* ── real Daraja API calls — same shape for sandbox and production,
 *    only the base URL and the credentials behind it differ ──────── */

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
  const data = await readDarajaJson(res, 'the access token request');
  const token = data.access_token;
  if (typeof token !== 'string' || !token) {
    throw new MpesaError('Safaricom authenticated but sent no access token', 'DARAJA_ERROR');
  }
  return token;
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

  // Daraja publishes no signature on its callbacks, so the shared secret
  // *is* the authentication: core only accepts a callback whose final
  // path segment matches it. The secret therefore has to be the last
  // segment of the URL we hand Safaricom — which is exactly the part
  // that is easy to leave off, and the failure is silent from here
  // (the push succeeds) and only visible much later as every callback
  // 404ing. Refuse the push instead, at the one moment we can still say
  // something useful about it.
  const secret = process.env.MPESA_CALLBACK_SECRET;
  if (secret) {
    const tail = callbackUrl.replace(/\/+$/, '').split('/').pop();
    if (tail !== secret) {
      throw new MpesaError(
        'MPESA_CALLBACK_SECRET is not the last path segment of MPESA_CALLBACK_URL, so Safaricom ' +
          'would be posting to a URL that core rejects. Append the secret to the URL: ' +
          `${callbackUrl.replace(/\/+$/, '')}/${secret}`,
        'NOT_CONFIGURED',
      );
    }
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

  const data = (await readDarajaJson(res, 'the STK push')) as {
    CheckoutRequestID?: string;
    MerchantRequestID?: string;
    ResponseDescription?: string;
  };
  if (!data.CheckoutRequestID) {
    // A 200 with no checkout id means the prompt never reached the phone.
    // Accepting it would leave the payer staring at a waiting screen that
    // can never resolve.
    //
    // Daraja's own ResponseDescription is quoted but never used as the
    // message: on exactly this response it says "Success", and a customer
    // told "Success" while no prompt was ever sent is worse than useless.
    const said = data.ResponseDescription ? ` Safaricom said: ${data.ResponseDescription}.` : '';
    throw new MpesaError(
      `Safaricom accepted the request but sent no checkout id, so no payment prompt reached your phone.${said}`,
      'DARAJA_ERROR',
    );
  }

  return {
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID ?? data.CheckoutRequestID,
    responseDescription: data.ResponseDescription ?? 'Accepted',
    autoConfirmed: false,
  };
}

/* ── B2C: Esoqo paying a customer, not the other way round ──────────────
 *
 * A wallet withdrawal or a third-party payout is Esoqo-initiated: nobody's
 * phone approves anything, so there is no "prompt" and no waiting screen —
 * Daraja either accepts the request (ResponseCode 0, a ConversationID to
 * track) or refuses it outright, and the actual outcome (paid or failed)
 * arrives later on the Result/Timeout URLs, exactly as asynchronous as the
 * STK callback but on a different pair of URLs and a different payload
 * shape (see parseB2CResultCallback below). */

export interface B2CPaymentRequest {
  msisdn: string; // E.164, e.g. +254712345678
  amountKes: number;
  /** "BusinessPayment" | "SalaryPayment" | "PromotionPayment" — Daraja's
   *  own CommandID enum. BusinessPayment is the correct one for a wallet
   *  withdrawal or a payout to someone else; the other two exist for
   *  payroll/promo use cases this codebase does not have. */
  commandId?: 'BusinessPayment' | 'SalaryPayment' | 'PromotionPayment';
  remarks: string;
  occasion?: string;
}

export interface B2CPaymentResult {
  conversationId: string;
  originatorConversationId: string;
  responseDescription: string;
  /** True when this call already settled the payout (console mode only). */
  autoConfirmed: boolean;
  mpesaTransactionId?: string;
}

export async function initiateB2CPayment(req: B2CPaymentRequest): Promise<B2CPaymentResult> {
  assertValidMsisdn(req.msisdn);

  const provider = mpesaProvider();

  if (provider === 'console') {
    await new Promise((r) => setTimeout(r, 800));
    const conversationId = `console-b2c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const transactionId = `CNSB2C${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
    console.log(
      `\n  ┌─ M-PESA B2C PAYOUT (console) ───────\n` +
      `  │  ${req.msisdn}\n` +
      `  │  KES ${req.amountKes.toLocaleString('en-KE')} — ${req.remarks}\n` +
      `  │  conversationId: ${conversationId}\n` +
      `  │  auto-confirmed with transaction id ${transactionId}\n` +
      `  └─────────────────────────────────────\n`,
    );
    return {
      conversationId,
      originatorConversationId: conversationId,
      responseDescription: 'Accepted (console — never enabled in a deployed environment)',
      autoConfirmed: true,
      mpesaTransactionId: transactionId,
    };
  }

  const base = provider === 'sandbox' ? SANDBOX_BASE : PRODUCTION_BASE;
  return initiateDarajaB2CPayment(req, base);
}

async function initiateDarajaB2CPayment(req: B2CPaymentRequest, base: string): Promise<B2CPaymentResult> {
  const shortcode = process.env.MPESA_B2C_SHORTCODE;
  const initiatorName = process.env.MPESA_INITIATOR_NAME;
  const initiatorPassword = process.env.MPESA_INITIATOR_PASSWORD;
  const certPem = process.env.MPESA_B2C_CERT;
  const resultUrl = process.env.MPESA_B2C_RESULT_URL;
  const timeoutUrl = process.env.MPESA_B2C_TIMEOUT_URL;
  if (!shortcode || !initiatorName || !initiatorPassword || !certPem || !resultUrl || !timeoutUrl) {
    throw new MpesaError(
      'MPESA_B2C_SHORTCODE/MPESA_INITIATOR_NAME/MPESA_INITIATOR_PASSWORD/MPESA_B2C_CERT/'
        + 'MPESA_B2C_RESULT_URL/MPESA_B2C_TIMEOUT_URL are not set',
      'NOT_CONFIGURED',
    );
  }

  const token = await getDarajaAccessToken(base);
  const securityCredential = buildSecurityCredential(initiatorPassword, certPem);
  const msisdnLocal = req.msisdn.replace('+', '');

  const res = await fetch(`${base}/mpesa/b2c/v1/paymentrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      InitiatorName: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: req.commandId ?? 'BusinessPayment',
      Amount: Math.round(req.amountKes),
      PartyA: shortcode,
      PartyB: msisdnLocal,
      Remarks: req.remarks.slice(0, 100),
      QueueTimeOutURL: timeoutUrl,
      ResultURL: resultUrl,
      Occasion: (req.occasion ?? '').slice(0, 100),
    }),
  });

  const data = (await readDarajaJson(res, 'the B2C payout')) as {
    ConversationID?: string;
    OriginatorConversationID?: string;
    ResponseDescription?: string;
    ResponseCode?: string;
  };
  if (!data.ConversationID) {
    const said = data.ResponseDescription ? ` Safaricom said: ${data.ResponseDescription}.` : '';
    throw new MpesaError(
      `Safaricom accepted the request but sent no conversation id, so the payout was never queued.${said}`,
      'DARAJA_ERROR',
    );
  }

  return {
    conversationId: data.ConversationID,
    originatorConversationId: data.OriginatorConversationID ?? data.ConversationID,
    responseDescription: data.ResponseDescription ?? 'Accepted',
    autoConfirmed: false,
  };
}

/**
 * Daraja's B2C result callback — shaped nothing like the STK callback.
 * Success and failure both land on the same ResultURL (a distinct
 * QueueTimeOutURL exists for the case where the request itself timed out
 * in Safaricom's queue, before any result was ever produced); the
 * parameters that matter come out of `Result.ResultParameters.ResultParameter`,
 * a name/value array rather than STK's `CallbackMetadata.Item`.
 */
export interface B2CResultCallback {
  conversationId: string;
  succeeded: boolean;
  resultDescription: string;
  mpesaTransactionId?: string;
  amountKes?: number;
}

export function parseB2CResultCallback(body: unknown): B2CResultCallback | null {
  const result = (body as { Result?: Record<string, unknown> })?.Result;
  if (!result || typeof result.ConversationID !== 'string') return null;

  const params = (result.ResultParameters as { ResultParameter?: { Key: string; Value: unknown }[] } | undefined)
    ?.ResultParameter ?? [];
  const param = (key: string): string | undefined => {
    const found = params.find((p) => p.Key === key)?.Value;
    return found === undefined || found === null ? undefined : String(found);
  };

  const amount = Number(param('TransactionAmount'));
  return {
    conversationId: result.ConversationID,
    succeeded: result.ResultCode === 0,
    resultDescription: String(result.ResultDesc ?? ''),
    mpesaTransactionId: param('TransactionReceipt'),
    amountKes: Number.isFinite(amount) ? amount : undefined,
  };
}

/* ── asking Safaricom what happened ──────────────────────────────────── */

/**
 * What a query can tell us. Note what is missing: there is no "failed"
 * verdict available from a *transport* problem, and that is deliberate.
 *
 * STK push is asynchronous. The customer's phone decides the outcome, and
 * the only way we learn it is the callback — which is a request from
 * Safaricom's servers to a URL that is, in practice, a developer's
 * laptop behind a free tunnel. When that leg breaks, the payment is stuck
 * PENDING and the payer is told nothing, which is the worst possible
 * outcome: not "failed", but unknowable, with real money possibly taken.
 *
 * So we ask Safaricom directly. This endpoint is the only way to find out
 * without the callback, and it is why FAILED is only ever returned when
 * Safaricom has actually said the payment did not go through.
 */
export type StkQueryState =
  /** The customer has not finished deciding. Ask again later. */
  | 'PENDING'
  /** Safaricom confirmed the money moved. */
  | 'COMPLETED'
  /** Safaricom said it did not: declined, cancelled, or timed out. */
  | 'FAILED'
  /** Too early to tell, or Safaricom would not answer. NOT a failure. */
  | 'UNKNOWN';

export interface StkQueryResult {
  state: StkQueryState;
  resultDescription: string;
  mpesaReceiptCode?: string;
  amountKes?: number;
}

export async function queryStkPush(checkoutRequestId: string): Promise<StkQueryResult> {
  const id = checkoutRequestId.trim();
  if (!id) return { state: 'UNKNOWN', resultDescription: 'No checkout id to query' };

  // Nothing to ask: console mode never talks to Safaricom, so there is no
  // remote state and inventing a verdict would be a lie.
  if (mpesaProvider() === 'console') {
    return { state: 'UNKNOWN', resultDescription: 'Console mode — no M-Pesa to ask' };
  }

  const base = mpesaProvider() === 'sandbox' ? SANDBOX_BASE : PRODUCTION_BASE;
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  if (!shortcode || !passkey) {
    throw new MpesaError('MPESA_SHORTCODE/MPESA_PASSKEY are not set', 'NOT_CONFIGURED');
  }

  const token = await getDarajaAccessToken(base);
  const timestamp = darajaTimestamp();
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

  const res = await fetch(`${base}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: id,
    }),
  });

  const data = (await readDarajaJson(res, 'the STK push status query')) as {
    ResponseCode?: string;
    ResponseDescription?: string;
    ResultCode?: string;
    ResultDesc?: string;
    CallbackMetadata?: { Item?: { Name: string; Value: unknown }[] };
  };

  const item = (name: string): string | undefined => {
    const found = (data.CallbackMetadata?.Item ?? []).find((i) => i.Name === name)?.Value;
    return found === undefined || found === null ? undefined : String(found);
  };

  // ResponseCode is about the *query request*; ResultCode is about the
  // *payment*. A query that itself was refused (too soon after the push,
  // or Safaricom has not finished processing) leaves ResultCode absent,
  // and that is emphatically not a failed payment.
  if (data.ResponseCode !== '0') {
    return {
      state: 'UNKNOWN',
      resultDescription: data.ResponseDescription ?? 'Safaricom would not answer the status query yet',
    };
  }

  if (data.ResultCode === '0') {
    const receipt = item('MpesaReceiptNumber');
    const amount = Number(item('Amount'));
    return {
      state: 'COMPLETED',
      resultDescription: data.ResultDesc ?? 'Completed',
      mpesaReceiptCode: receipt,
      amountKes: Number.isFinite(amount) ? amount : undefined,
    };
  }

  // Only a real code is a verdict. Daraja answers a push it is still
  // working on with ResponseCode 0 and an EMPTY ResultCode, and reading
  // that as "not 0, therefore failed" would tell a customer who is busy
  // approving the prompt that their payment was declined.
  const code = (data.ResultCode ?? '').trim();
  if (!code) {
    return {
      state: 'UNKNOWN',
      resultDescription: data.ResponseDescription ?? 'Safaricom has not finished processing this payment',
    };
  }

  return {
    state: 'FAILED',
    resultDescription: data.ResultDesc ?? data.ResponseDescription ?? 'The payment was not completed',
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
