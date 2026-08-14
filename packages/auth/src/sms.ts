import 'server-only';
import { appEnv } from '@esoko/domain';

/**
 * Resolves the SMS provider for this run mode (see packages/domain/src/env.ts):
 *   development     → console — never dials a real gateway, whatever
 *                     credentials are lying around in .env
 *   LOCAL_TEST_PROD → sandbox unless SMS_PROVIDER is set — production
 *                     behaviour rehearsed locally (Africa's Talking
 *                     sandbox credentials bill nothing)
 *   production      → SMS_PROVIDER as set (default console)
 */
export function smsProvider(): string {
  if (appEnv() === 'development') return 'console';
  if (appEnv() === 'LOCAL_TEST_PROD') return process.env.SMS_PROVIDER ?? 'sandbox';
  return process.env.SMS_PROVIDER ?? 'console';
}

/**
 * The one SMS sender in this codebase — Africa's Talking shape, swap
 * per ADR-0005. Used for OTP codes (otp.ts) and for anything else that
 * needs to text a phone (receipts, in apps/store's pos/receipt-actions.ts).
 * Callers that spend real money per send (OTP's daily cap, for one) own
 * their own budget/rate-limit check before calling this — this function
 * only knows how to put a message on the wire.
 *
 * It does own the provider gate resolved by smsProvider(): in console mode
 * it prints instead of dialing the real gateway, so no caller can burn a
 * live request from a dev box. OTP keeps its own console short-circuit
 * (it carries the dev code), so it never reaches here in console mode.
 */
export async function sendSms(to: string, message: string): Promise<void> {
  const provider = smsProvider();

  if (provider === 'console') {
    console.log(`\n  ┌─ SMS (console) ─────────────────────\n  │  to: ${to}\n  │  ${message}\n  └───────────────────────────────────\n`);
    return;
  }

  const username = process.env.SMS_USERNAME;
  const apiKey = process.env.SMS_API_KEY;
  if (!username || !apiKey) throw new Error('SMS credentials not configured');

  let res: Response;
  try {
    res = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        username,
        to,
        message,
        from: process.env.SMS_SENDER_ID ?? 'ESOKO',
      }),
    });
  } catch (e) {
    console.error('[SMS] send failed', e);
    throw new Error('Could not send the message — the SMS provider is unreachable');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[SMS] send failed', res.status, body);
    throw new Error(res.status === 401 || res.status === 403 ? 'SMS credentials were rejected' : 'Could not send the message');
  }
}
