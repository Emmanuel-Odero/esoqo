"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIpFrom, isSystemHandleShape } from "@esoqo/domain";
import { checkRateLimit, RateLimitError } from "@esoqo/auth";
import { goUrl } from "@/lib/ticketing";
import { setParcelOrgSession } from "@/lib/parcel-org-session";

export type SignInResult = { ok: false; error: string };

/** Same message whether the name didn't match or the PIN was wrong —
 *  telling those apart is exactly what lets someone enumerate a
 *  company's staff one guess at a time. core-go holds the same contract
 *  (DummyPinHash on miss), so the timing matches too. */
const BAD_CREDENTIALS = "Name or PIN is incorrect";

/**
 * Courier-company staff sign-in — the parcel equivalent of
 * ticketStaffSignIn beside it, and rate-limited the same three ways.
 *
 * Three limits, not one, because they stop different attacks: per
 * org+name bounds guesses at one named rider, per org bounds spraying
 * across a whole company's roster, and per IP bounds a single host
 * working through many companies. core-go adds its own per-subject
 * lockout underneath; this is the transport-level bound that the
 * account-level one can't see.
 */
export async function parcelStaffSignIn(
  orgSlug: string,
  raw: unknown,
): Promise<SignInResult> {
  const form = raw as { name?: unknown; esokoId?: unknown; pin?: unknown };
  const name = typeof form?.name === "string" ? form.name.trim() : "";
  const suppliedEsoqoId =
    typeof form?.esokoId === "string" ? form.esokoId.trim() : "";
  // A single field accepts either a name or an Esoqo ID, so decide by
  // shape rather than by a retired prefix. Anything handle-shaped is
  // taken as the ID; anything else is treated as a name to search on.
  const esokoId =
    suppliedEsoqoId || (isSystemHandleShape(name) ? name : "");
  const pin = typeof form?.pin === "string" ? form.pin.trim() : "";
  if (!name && !esokoId)
    return { ok: false, error: "Enter your name or Esoqo ID" };
  if (pin.length < 4) return { ok: false, error: "Enter your PIN" };

  const h = await headers();
  const ip = clientIpFrom((n) => h.get(n)) ?? "unknown";
  const nameKey = (name || esokoId).toLowerCase();

  try {
    await checkRateLimit(`parcel-staff-signin:${orgSlug}:${nameKey}`, 6, 900);
    await checkRateLimit(`parcel-staff-signin-org:${orgSlug}`, 30, 900);
    await checkRateLimit(`parcel-staff-signin-ip:${ip}`, 20, 900);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return {
        ok: false,
        error: "Too many attempts — try again in a few minutes",
      };
    }
    throw e;
  }

  let res: Response;
  try {
    res = await fetch(goUrl("/v1/parcel-orgs/staff/signin"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgSlug, name, esokoId, pin }),
      cache: "no-store",
    });
  } catch (e) {
    console.error(e);
    return {
      ok: false,
      error: "Could not reach the sign-in service. Try again.",
    };
  }
  if (!res.ok) return { ok: false, error: BAD_CREDENTIALS };

  const json = (await res.json().catch(() => null)) as {
    token?: string;
    orgId?: string;
  } | null;
  if (!json?.token || !json.orgId) return { ok: false, error: BAD_CREDENTIALS };

  // The cookie carries core-go's bearer and nothing else — no org id,
  // no role, no capability list. Everything the portal renders is
  // re-read from /v1/parcel-orgs/me on each page, so there is exactly
  // one place that decides what this login can see.
  await setParcelOrgSession(json.token);
  redirect("/parcel-org");
}
