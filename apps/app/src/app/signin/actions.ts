"use server";

import { cookies, headers } from "next/headers";
import { SESSION_COOKIE, checkRateLimit, RateLimitError } from "@esoqo/auth";
import {
  signInSchema,
  requestPinCodeSchema,
  setPinSchema,
  clientIpFrom,
} from "@esoqo/domain";

export type ActionResult<T = void> =
  { ok: true; data: T } | { ok: false; error: string; field?: string };

async function clientIp(): Promise<string> {
  const h = await headers();
  return clientIpFrom((n) => h.get(n)) ?? "unknown";
}

/**
 * core-go sits behind Docker's bridge network — reachable at `core-go:4100`
 * from inside the compose stack, but only at `localhost:4100` on the bare
 * host (an unresolvable `core-go` there is exactly what surfaces as a raw
 * "fetch failed" TypeError). Try the configured URL twice on fresh
 * connections, then a loopback form of it as a last resort.
 */
const CORE_GO_HOSTS = (() => {
  const base = process.env.CORE_GO_API_URL ?? "http://localhost:4100";
  const hosts = [base, base];
  try {
    const url = new URL(base);
    if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      const loopback = new URL(base);
      loopback.hostname = "127.0.0.1";
      hosts.push(loopback.toString());
    }
  } catch {
    /* keep the configured base as-is */
  }
  return hosts;
})();

/**
 * Subject OTP/PIN/session now live in services/core-go — see
 * docs/adr/0005-mobile-api-in-go.md — so this app, apps/store and the
 * mobile client all share one implementation instead of each carrying
 * their own copy of findSubjectCredential/recordSignInSuccess/
 * recordSignInFailure/setSubjectPin (packages/db/src/dal/auth-credential.ts)
 * and issueOtp/verifyOtp for the PIN_RESET purpose (packages/auth/src/otp.ts).
 * Session *validation* is unchanged (packages/auth/src/session.ts's
 * ctxFromToken, via apps/app/src/lib/session.ts) — core-go writes to the
 * same Redis, in the same format, so nothing downstream of sign-in needed
 * to change.
 */
async function coreGoFetch<T>(
  path: string,
  body: unknown,
): Promise<
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string }
> {
  // Each candidate host gets one fresh-connection fetch — an idle
  // keep-alive socket is occasionally torn down by Docker Desktop's NAT,
  // which surfaces as a bare "fetch failed" TypeError (see CORE_GO_HOSTS).
  // If every attempt fails, degrade to a typed failure instead of leaking
  // the TypeError out of the Server Action.
  let lastError: unknown;
  for (const base of CORE_GO_HOSTS) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          code: json?.error?.code ?? "UNKNOWN",
          message: json?.error?.message ?? "Something went wrong",
        };
      }
      return { ok: true, data: json as T };
    } catch (e) {
      lastError = e;
    }
  }
  console.warn(
    `[core-go] ${path} unreachable after ${CORE_GO_HOSTS.length} attempt(s):`,
    lastError,
  );
  return {
    ok: false,
    status: 0,
    code: "UNAVAILABLE",
    message: "Could not reach the sign-in service, try again in a moment.",
  };
}

async function startSessionFromToken(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

/**
 * Phone OR email + PIN. A PUBLIC HTTP ENDPOINT wearing a function
 * signature — validated at the boundary, rate-limited per IP, and every
 * failure path is deliberately generic ("No account, or PIN not set")
 * so a wrong guess can't be used to enumerate which numbers are
 * registered. The credential check itself, and the anti-enumeration
 * DUMMY_PIN_HASH comparison, now happen in core-go — see
 * internal/httpapi/handlers_auth.go's handleSignIn.
 */
export async function actionSignIn(
  raw: unknown,
): Promise<ActionResult<{ next: string }>> {
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check your details",
    };
  const { identifier, pin } = parsed.data;

  try {
    await checkRateLimit(`signin:${await clientIp()}`, 10, 300);
  } catch (e) {
    if (e instanceof RateLimitError)
      return {
        ok: false,
        error: "Too many attempts. Try again in a few minutes.",
      };
    throw e;
  }

  const result = await coreGoFetch<{ token: string }>("/v1/auth/sign-in", {
    identifier,
    pin,
  });
  if (!result.ok) {
    if (result.code === "ACCOUNT_FROZEN")
      return { ok: false, error: result.message };
    // status 0 is the "core-go unreachable" path — don't present an
    // unavailable service as a wrong identifier.
    if (result.status === 0) return { ok: false, error: result.message };
    return { ok: false, error: result.message, field: "identifier" };
  }

  await startSessionFromToken(result.data.token);
  return { ok: true, data: { next: "/me" } };
}

/**
 * Step 1 of setting/resetting a PIN — sends (or, in console mode, logs to
 * the terminal; in mock mode, sends to the local mock-sms catcher) a code.
 */
export async function actionRequestPinCode(
  raw: unknown,
): Promise<ActionResult> {
  const parsed = requestPinCodeSchema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid number",
    };

  const result = await coreGoFetch("/v1/auth/otp", {
    msisdn: parsed.data.msisdn,
    purpose: "PIN_RESET",
  });
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, data: undefined };
}

/** Step 2 — verifies the code, sets the PIN, and signs the subject straight in. */
export async function actionSetPin(
  raw: unknown,
): Promise<ActionResult<{ next: string }>> {
  const parsed = setPinSchema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check your details",
    };
  const { msisdn, code, pin } = parsed.data;

  // If code is provided, use /v1/auth/pin/reset (for forgot PIN flow)
  // If code is missing (from registration), we need to handle it differently
  const path = code ? "/v1/auth/pin/reset" : "/v1/auth/pin/set-without-code";

  const result = await coreGoFetch<{ token: string }>(path, {
    msisdn,
    code,
    pin,
  });
  if (!result.ok) {
    const field =
      result.code === "WRONG_CODE" ||
      result.code === "EXPIRED" ||
      result.code === "TOO_MANY_ATTEMPTS"
        ? "code"
        : result.code === "WEAK_PIN"
          ? "pin"
          : undefined;
    return { ok: false, error: result.message, field };
  }

  await startSessionFromToken(result.data.token);
  return { ok: true, data: { next: "/me" } };
}
