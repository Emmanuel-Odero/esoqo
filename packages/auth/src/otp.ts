import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { redis } from "./redis";
import { checkRateLimit, RateLimitError } from "./ratelimit";
import { sendSms, smsProvider } from "./sms";
import { sms } from "@esoqo/domain";

/**
 * One-time codes.
 *
 * The threat that actually costs money here is SMS pumping — an attacker
 * cycling premium-rate numbers to farm carrier revenue. It can burn a real
 * budget overnight and it is the single most expensive attack available
 * against this product. Hence: per-MSISDN limits, per-IP limits,
 * exponential cooldown, prefix allow-listing, and a hard daily spend cap
 * that stops sending and pages a human.
 *
 * Codes are never stored. Only HMAC(code, OTP_PEPPER).
 */

const PEPPER = process.env.OTP_PEPPER ?? "dev-pepper-change-me";
const TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;
const DAILY_CAP_KES = Number(process.env.OTP_DAILY_SPEND_CAP_KES ?? 5000);
const SMS_COST_KES = 0.8; // per segment — replace with the real aggregator rate

export type OtpPurpose =
  "REGISTRATION" | "SIGN_IN" | "PIN_RESET" | "STEP_UP" | "CONSENT_GRANT";

/** What the code is *for*, in the recipient's words. */
const PURPOSE_PHRASE: Record<OtpPurpose, string> = {
  REGISTRATION: "finish signing up",
  SIGN_IN: "sign in",
  PIN_RESET: "reset your PIN",
  STEP_UP: "confirm it is you",
  CONSENT_GRANT: "approve this request",
};

/**
 * The one-time-code message.
 *
 * Code first: it is the only part anyone reads, most handsets surface
 * the opening characters in the notification shade, and Android's SMS
 * autofill looks for a code near the start.
 *
 * Naming the purpose is an anti-phishing measure, not decoration. A
 * code that says "to reset your PIN" arriving at someone who was only
 * signing in is a signal that something is wrong, and it is the only
 * signal we can give them before they hand the code over. Banks do this
 * for the same reason.
 *
 * "Esoqo will never ask you for it" stays. It is the single most
 * valuable sentence in the message: every SMS-code fraud in this market
 * runs through a phone call asking the victim to read it out.
 */
export function otpSms(code: string, purpose: OtpPurpose): string {
  return sms`${code} is your Esoqo code to ${PURPOSE_PHRASE[purpose]}. It expires in 10 minutes. Esoqo will never ask you for it.`;
}

function hashCode(code: string, msisdn: string): string {
  return createHmac("sha256", PEPPER).update(`${msisdn}:${code}`).digest("hex");
}

function key(msisdn: string, purpose: OtpPurpose) {
  return `otp:${purpose}:${msisdn}`;
}

/** Only Safaricom, Airtel and Telkom mobile prefixes. Blocks premium-rate ranges. */
export function isAllowedPrefix(e164: string): boolean {
  if (!e164.startsWith("+254")) return false;
  const local = e164.slice(4);
  return /^(7\d{8}|1[01]\d{7})$/.test(local);
}

export class OtpError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "RATE_LIMITED"
      | "BAD_PREFIX"
      | "SPEND_CAP"
      | "EXPIRED"
      | "TOO_MANY_ATTEMPTS"
      | "WRONG_CODE",
  ) {
    super(message);
    this.name = "OtpError";
  }
}

export interface SendResult {
  expiresAt: Date;
  cooldownSeconds: number;
}

export async function issueOtp(
  msisdn: string,
  purpose: OtpPurpose,
  ip?: string | null,
): Promise<SendResult> {
  if (!isAllowedPrefix(msisdn)) {
    throw new OtpError(
      "That is not a Kenyan mobile number we can send to",
      "BAD_PREFIX",
    );
  }

  // Check if there's already a valid OTP for this number and purpose
  // to avoid sending duplicate codes within a short time window
  const existingKey = key(msisdn, purpose);
  const existing = await redis.hgetall(existingKey);
  if (existing?.hash) {
    const ttl = await redis.ttl(existingKey);
    // If there's a valid code that still has more than 8 minutes left (80% of 10min),
    // don't send a new one - return the existing expiration time instead
    if (ttl > 480) {
      const cooldownSeconds = 60; // Standard cooldown when reusing existing code
      return {
        expiresAt: new Date(Date.now() + ttl * 1000),
        cooldownSeconds,
      };
    }
  }

  // Per-number: 5 per hour. Per-IP: 20 per hour.
  try {
    await checkRateLimit(
      `otp:msisdn:${msisdn}`,
      Number(process.env.OTP_RATE_LIMIT_PER_HOUR ?? 5),
      3600,
    );
    if (ip) await checkRateLimit(`otp:ip:${ip}`, 20, 3600);
  } catch (e) {
    if (e instanceof RateLimitError) {
      throw new OtpError(
        "Too many codes requested. Try again in a little while.",
        "RATE_LIMITED",
      );
    }
    throw e;
  }

  // Hard daily spend cap. If this trips, sending stops and ops is paged.
  const spendKey = `otp:spend:${new Date().toISOString().slice(0, 10)}`;
  const spent = Number((await redis.get(spendKey)) ?? 0);
  if (spent + SMS_COST_KES > DAILY_CAP_KES) {
    console.error("[OTP] DAILY SPEND CAP REACHED — sending halted", {
      spent,
      cap: DAILY_CAP_KES,
    });
    throw new OtpError(
      "Verification is temporarily unavailable. Please try later.",
      "SPEND_CAP",
    );
  }

  // Exponential cooldown between sends to the same number.
  const sendCountKey = `otp:sends:${msisdn}`;
  const sends = Number((await redis.get(sendCountKey)) ?? 0);
  const cooldown = Math.min(30 * 2 ** sends, 900);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);

  const results = await redis
    .multi()
    .hset(key(msisdn, purpose), "hash", hashCode(code, msisdn), "attempts", 0)
    .expire(key(msisdn, purpose), TTL_SECONDS)
    .incr(sendCountKey)
    .expire(sendCountKey, 3600)
    .incrbyfloat(spendKey, SMS_COST_KES)
    .expire(spendKey, 172_800)
    .exec();

  // If Redis transaction failed (e.g., memory limit reached, connection lost),
  // don't proceed to send SMS. This ensures we never send a code that wasn't
  // successfully stored, which would cause immediate "That code has expired" errors.
  if (!results || results.some((r) => r instanceof Error)) {
    const err = results?.find((r) => r instanceof Error) as Error | undefined;
    throw new Error(
      `Failed to store OTP: ${err?.message ?? "Redis transaction failed"}`,
    );
  }

  const provider = smsProvider();
  if (provider === "console") {
    // Never returned to the caller/browser — terminal only. Use
    // SMS_PROVIDER=mock (packages/auth/src/sms.ts) to read the code from
    // the mock-sms catcher UI instead if you'd rather not watch logs.
    console.log(
      `\n  ┌─ OTP ─────────────────────────────\n  │  ${msisdn}\n  │  code: ${code}\n  │  purpose: ${purpose}\n  └───────────────────────────────────\n`,
    );
    return { expiresAt, cooldownSeconds: cooldown };
  }

  await sendSms(msisdn, otpSms(code, purpose), "otp");
  return { expiresAt, cooldownSeconds: cooldown };
}

export async function verifyOtp(
  msisdn: string,
  purpose: OtpPurpose,
  code: string,
): Promise<boolean> {
  const k = key(msisdn, purpose);
  const rec = await redis.hgetall(k);
  if (!rec?.hash)
    throw new OtpError("That code has expired. Ask for a new one.", "EXPIRED");

  const attempts = Number(rec.attempts ?? 0);
  if (attempts >= MAX_ATTEMPTS) {
    await redis.del(k);
    throw new OtpError(
      "Too many wrong attempts. Ask for a new code.",
      "TOO_MANY_ATTEMPTS",
    );
  }

  const expected = Buffer.from(rec.hash, "hex");
  const actual = Buffer.from(hashCode(code, msisdn), "hex");
  const ok =
    expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!ok) {
    await redis.hincrby(k, "attempts", 1);
    throw new OtpError(
      `That code is not right. ${MAX_ATTEMPTS - attempts - 1} tries left.`,
      "WRONG_CODE",
    );
  }

  await redis.del(k);
  await redis.del(`otp:sends:${msisdn}`);
  return true;
}
