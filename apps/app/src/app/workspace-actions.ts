"use server";

import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@esoqo/auth";
import { goUrl } from "@/lib/ticketing";
import { setParcelOrgSession } from "@/lib/parcel-org-session";
import { setOrgSession } from "@/lib/org-session";
import { getOrgTypeConfig } from "@/lib/org-type-config";

/**
 * Generic org entry for any organization type.
 *
 * The person's own Esoqo session (SESSION_COOKIE) is the credential;
 * the API checks it against an active org_staff row before minting the
 * organization-scoped session, so the org id is a selector over orgs they
 * already hold, not a grant. On success we plant the org session cookie
 * and navigate to the org portal.
 *
 * Replaces courier-specific enterParcelOrg with a generic version that
 * works for any org type (courier, hotel, eatery, chama, tout, etc.).
 *
 * Lives at the app root because all portals now offer the same switcher,
 * and switching between two of your own organizations should not require
 * going through /me first.
 */
export async function enterOrg(orgId: string, orgType: string): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/signin");

  // Courier activates through its own legacy endpoint, not the generic
  // one. The generic path resolves capabilities against the new
  // orgtypes registry, but every /parcel-org page checks capabilities
  // computed by the legacy parcelStaffCapabilities() against the legacy
  // parcel_staff table — the two don't agree on what a role like "ceo"
  // can do, so a session minted the generic way looks signed-in (the
  // dashboard needs little) but gets DENIED on anything gated by a real
  // capability (staff list, dispatch, settings writes).
  const endpoint = orgType === "courier"
    ? "/v1/me/parcel-orgs/activate"
    : `/v1/orgs/${orgId}/session`;
  const body = orgType === "courier" ? { orgId } : { orgType };

  let sessionToken: string | undefined;
  try {
    const res = await fetch(goUrl(endpoint), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => null)) as {
      token?: string;
    } | null;
    if (res.ok) sessionToken = json?.token;
  } catch {
    // Fall through to error redirect
  }

  if (!sessionToken) redirect("/me?orgError=1");

  // Courier keeps its legacy cookie name for backward compat; every
  // other org type goes through the generic org session cookie, which
  // is what OrgPortalShell's fetchOrgMe actually reads.
  if (orgType === "courier") {
    await setParcelOrgSession(sessionToken);
  } else {
    await setOrgSession(orgType, sessionToken);
  }

  // Get org type config to determine portal route
  const config = getOrgTypeConfig(orgType);
  const portalRoute = config?.portalRoute || "/org/default";

  // /parcel-org (courier's real portal) takes no id in its URL at all —
  // it's entirely session-scoped, same as every page under it. Every
  // other org type's portal route is still a dynamic [id] segment.
  if (orgType === "courier") {
    redirect(portalRoute as Route);
  }

  redirect((portalRoute + "/" + orgId) as Route);
}

/**
 * @deprecated Use enterOrg instead. Kept for backward compatibility.
 */
export async function enterParcelOrg(orgId: string): Promise<void> {
  return enterOrg(orgId, "courier");
}
