/**
 * The Daraja error path, tested against the failure modes a real network
 * produces rather than the ones a clean mock produces.
 *
 * The bug these lock down was invisible from the happy path: every test
 * that returned well-formed JSON passed, while a gateway answering with
 * HTML threw a SyntaxError that was not an MpesaError, escaped the
 * provider's own error handling entirely, and reached the customer as "we
 * could not start that payment" — with the actual cause discarded.
 */

import { strict as assert } from 'node:assert';

import { afterEach, expect, test } from 'vitest';

import { initiateStkPush, queryStkPush, MpesaError, mpesaProvider } from './mpesa';

const MSISDN = '+254712345678';

const CREDENTIALS: Record<string, string> = {
  MPESA_CONSUMER_KEY: 'k',
  MPESA_CONSUMER_SECRET: 's',
  MPESA_SHORTCODE: '174379',
  MPESA_PASSKEY: 'bfb27f5459e9cd3eb1a56a5c3c4b5c8d',
  MPESA_CALLBACK_URL: 'https://example.test/webhooks/mpesa/stk-callback',
};

const PUSH = { msisdn: MSISDN, amountKes: 50, accountReference: 'ESOQO X', description: 'Payment' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function htmlResponse(body: string, status: number, statusText = ''): Response {
  return new Response(body, { status, statusText, headers: { 'Content-Type': 'text/html' } });
}

const okToken = (): Response => jsonResponse({ access_token: 'tok', expires_in: '3599' });

/** The error a call rejects with, or null if it resolved. */
async function failure(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

/** Swap process.env and fetch for one call, then put both back. */
async function withEnv<T>(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

afterEach(() => {
  process.env.MPESA_PROVIDER = 'console';
});

test('sandbox: a successful push returns the checkout id and waits for the callback', async () => {
  let pushCalls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('/oauth/')) return okToken();
    pushCalls++;
    return jsonResponse({
      MerchantRequestID: 'm-1',
      CheckoutRequestID: 'ws_CO_1',
      ResponseCode: '0',
      ResponseDescription: 'Success. Request accepted for processing',
    });
  };

  const res = await withEnv({ ...CREDENTIALS, MPESA_PROVIDER: 'sandbox' }, fetchImpl, () =>
    initiateStkPush(PUSH),
  );

  assert.equal(pushCalls, 1);
  assert.equal(res.checkoutRequestId, 'ws_CO_1');
  // A real STK push is never locally confirmed: Safaricom calls the
  // webhook later. Treating it as confirmed would mark a payment paid
  // before the customer has entered their PIN.
  assert.equal(res.autoConfirmed, false);
});

test('an HTML error page becomes an MpesaError naming the status, not a SyntaxError', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('/oauth/')) return okToken();
    return htmlResponse('<html><head><title>502 Bad Gateway</title></head></html>', 502, 'Bad Gateway');
  };

  const err = await withEnv({ ...CREDENTIALS, MPESA_PROVIDER: 'sandbox' }, fetchImpl, () =>
    failure(initiateStkPush(PUSH)),
  );

  // This is the whole point: the caller catches MpesaError and shows the
  // real reason. A SyntaxError here slips past that and surfaces as the
  // generic "we could not start that payment".
  expect(err).toBeInstanceOf(MpesaError);
  const e = err as MpesaError;
  assert.equal(e.code, 'DARAJA_ERROR');
  assert.match(e.message, /502/, 'the status code must survive into the message');
  assert.match(e.message, /Bad Gateway/, 'the body must survive into the message');
  assert.match(e.message, /proxy or gateway/i, 'the message should say what usually causes this');
});

test('an HTML error page from the token endpoint is also an MpesaError', async () => {
  const fetchImpl: typeof fetch = async () =>
    htmlResponse('<html>Service Unavailable</html>', 503, 'Service Unavailable');

  const err = await withEnv({ ...CREDENTIALS, MPESA_PROVIDER: 'sandbox' }, fetchImpl, () =>
    failure(initiateStkPush(PUSH)),
  );

  expect(err).toBeInstanceOf(MpesaError);
  assert.match((err as Error).message, /503/);
});

test('a JSON error from Daraja is reported in Daraja’s own words', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('/oauth/')) return okToken();
    return jsonResponse({ ResultCode: '1', errorMessage: 'Invalid Passkey' }, 400);
  };

  const err = await withEnv({ ...CREDENTIALS, MPESA_PROVIDER: 'sandbox' }, fetchImpl, () =>
    failure(initiateStkPush(PUSH)),
  );

  expect(err).toBeInstanceOf(MpesaError);
  // Daraja already writes the sentence a human needs; do not replace it.
  assert.equal((err as Error).message, 'Invalid Passkey');
});

test('missing credentials say which ones, before any network call', async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return okToken();
  };

  const err = await withEnv(
    {
      MPESA_PROVIDER: 'sandbox',
      MPESA_CONSUMER_KEY: undefined,
      MPESA_CONSUMER_SECRET: undefined,
      MPESA_SHORTCODE: '174379',
      MPESA_PASSKEY: 'x',
      MPESA_CALLBACK_URL: 'https://example.test/cb',
    },
    fetchImpl,
    () => failure(initiateStkPush(PUSH)),
  );

  expect(err).toBeInstanceOf(MpesaError);
  assert.equal((err as MpesaError).code, 'NOT_CONFIGURED');
  assert.equal(called, false, 'must not hit the network with no credentials');
});

test('a 200 with no checkout id is a failure, not a pending payment', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('/oauth/')) return okToken();
    // The shape that would leave a payer staring at a waiting screen that
    // can never resolve, because no prompt was ever sent.
    return jsonResponse({ ResponseCode: '0', ResponseDescription: 'Success' });
  };

  const err = await withEnv({ ...CREDENTIALS, MPESA_PROVIDER: 'sandbox' }, fetchImpl, () =>
    failure(initiateStkPush(PUSH)),
  );

  expect(err).toBeInstanceOf(MpesaError);
  const msg = (err as Error).message;
  assert.match(msg, /no checkout id/i);
  // Daraja's ResponseDescription is "Success" on this very response. If
  // it were allowed to BE the message, the customer would be told
  // "Success" while no prompt had reached their phone.
  assert.notEqual(msg, 'Success');
  assert.doesNotMatch(msg, /^Success\b/);
});

test('a local number is rejected before a request is made', async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return okToken();
  };

  const err = await withEnv({ ...CREDENTIALS, MPESA_PROVIDER: 'sandbox' }, fetchImpl, () =>
    failure(initiateStkPush({ ...PUSH, msisdn: '0712345678' })),
  );

  expect(err).toBeInstanceOf(MpesaError);
  assert.equal((err as MpesaError).code, 'INVALID_MSISDN');
  assert.equal(called, false);
});

test('the provider is read per call, so a changed .env takes effect without a restart', async () => {
  // A module-level cache here is a switch nobody can see: the box keeps
  // the old mode, and the dangerous direction is staying on console after
  // being pointed at the sandbox — every payment auto-confirms and no
  // money ever reaches Safaricom.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('network must not be reached in console mode');
  }) as typeof fetch;
  try {
    process.env.MPESA_PROVIDER = 'console';
    assert.equal(mpesaProvider(), 'console');
    const first = await initiateStkPush(PUSH);
    assert.equal(first.autoConfirmed, true);

    process.env.MPESA_PROVIDER = 'sandbox';
    assert.equal(mpesaProvider(), 'sandbox', 'the provider must be re-read, not cached');
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* ── the status query ────────────────────────────────────────────────────
 * The case that matters most is the one with no verdict in it. A query
 * that cannot be answered must never come back as FAILED, because FAILED
 * is shown to a customer as "nothing was charged" — and the whole reason
 * they are asking is that they cannot see whether the money went. */

test('query: a completed push reports the receipt and amount', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('/oauth/')) return okToken();
    return jsonResponse({
      ResponseCode: '0',
      ResponseDescription: 'Success',
      ResultCode: '0',
      ResultDesc: 'The service request is processed successfully.',
      CallbackMetadata: {
        Item: [
          { Name: 'MpesaReceiptNumber', Value: 'QJG7X8K2LM' },
          { Name: 'Amount', Value: 30 },
        ],
      },
    });
  };

  const res = await withEnv({ ...CREDENTIALS, MPESA_PROVIDER: 'sandbox' }, fetchImpl, () =>
    queryStkPush('ws_CO_1'),
  );

  assert.equal(res.state, 'COMPLETED');
  assert.equal(res.mpesaReceiptCode, 'QJG7X8K2LM');
  assert.equal(res.amountKes, 30);
});

test('query: the customer cancelled is a definite failure', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('/oauth/')) return okToken();
    return jsonResponse({
      ResponseCode: '0',
      ResultCode: '1032',
      ResultDesc: 'Request cancelled by user',
    });
  };

  const res = await withEnv({ ...CREDENTIALS, MPESA_PROVIDER: 'sandbox' }, fetchImpl, () =>
    queryStkPush('ws_CO_1'),
  );

  assert.equal(res.state, 'FAILED');
  assert.equal(res.resultDescription, 'Request cancelled by user');
});

test('query: too early to answer is UNKNOWN, not a failed payment', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('/oauth/')) return okToken();
    return jsonResponse({
      ResponseCode: '0',
      ResponseDescription: 'Accepted',
      ResultCode: '',
      ResultDesc: '',
    });
  };

  const res = await withEnv({ ...CREDENTIALS, MPESA_PROVIDER: 'sandbox' }, fetchImpl, () =>
    queryStkPush('ws_CO_1'),
  );

  assert.equal(res.state, 'UNKNOWN');
});

test('query: a refused query request is UNKNOWN, not a failed payment', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('/oauth/')) return okToken();
    return jsonResponse({
      ResponseCode: '1002',
      ResponseDescription: 'The request could not be processed at this time',
    });
  };

  const res = await withEnv({ ...CREDENTIALS, MPESA_PROVIDER: 'sandbox' }, fetchImpl, () =>
    queryStkPush('ws_CO_1'),
  );

  assert.equal(res.state, 'UNKNOWN');
});

test('query: a Daraja outage leaves the payment UNKNOWN rather than failed', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('/oauth/')) return okToken();
    return htmlResponse('<html>Service Unavailable</html>', 503, 'Service Unavailable');
  };

  const err = await failure(
    withEnv({ ...CREDENTIALS, MPESA_PROVIDER: 'sandbox' }, fetchImpl, () => queryStkPush('ws_CO_1')),
  );

  // The caller turns an MpesaError into "keep waiting" — see
  // reconcileBusinessPayment. What matters is that it is not a verdict.
  assert.ok(err instanceof MpesaError, 'expected an MpesaError, got ' + String(err));
});

test('query: console mode has nothing to ask and must not guess', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('network must not be reached in console mode');
  }) as typeof fetch;
  try {
    process.env.MPESA_PROVIDER = 'console';
    const res = await queryStkPush('ws_CO_1');
    assert.equal(res.state, 'UNKNOWN');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('query: an empty checkout id is refused before any network call', async () => {
  const res = await queryStkPush('   ');
  assert.equal(res.state, 'UNKNOWN');
});

test('a callback URL without the secret is refused before the money moves', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('/oauth/')) return okToken();
    throw new Error('must not push: a callback that core will 404 can never settle a payment');
  };

  const err = await failure(
    withEnv(
      { ...CREDENTIALS, MPESA_PROVIDER: 'sandbox', MPESA_CALLBACK_SECRET: 's3cret' },
      fetchImpl,
      () => initiateStkPush(PUSH),
    ),
  );

  assert.ok(err instanceof MpesaError, 'expected an MpesaError, got ' + String(err));
  // The message has to carry the fix, because the developer seeing this is
  // looking at a push that otherwise succeeded and a callback that never
  // arrives — with nothing to connect the two.
  assert.match(String((err as MpesaError).message), /\/s3cret/);
});

test('a callback URL that already carries the secret is accepted', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('/oauth/')) return okToken();
    return jsonResponse({ CheckoutRequestID: 'ws_CO_2', ResponseCode: '0' });
  };

  const res = await withEnv(
    {
      ...CREDENTIALS,
      MPESA_PROVIDER: 'sandbox',
      MPESA_CALLBACK_SECRET: 's3cret',
      MPESA_CALLBACK_URL: 'https://example.test/webhooks/mpesa/stk-callback/s3cret',
    },
    fetchImpl,
    () => initiateStkPush(PUSH),
  );

  assert.equal(res.checkoutRequestId, 'ws_CO_2');
});
