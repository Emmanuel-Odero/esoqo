"use server";

import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@esoqo/auth";
import { goUrl } from "@/lib/ticketing";
import { setParcelOrgSession } from "@/lib/parcel-org-session";
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

  let sessionToken: string | undefined;
  try {
    const res = await fetch(goUrl("/v1/orgs/{orgId}/session"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orgType }),
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

  // Use the generic session cookie handling
  // For backward compat during courier migration, courier still uses old cookie name
  if (orgType === "courier") {
    await setParcelOrgSession(sessionToken);
  } else {
    // For other org types, store in generic org session cookie
    // This will be handled by a generic setOrgSession function
    // For now, use the parcel org session as fallback
    await setParcelOrgSession(sessionToken);
  }

  // Get org type config to determine portal route
  const config = getOrgTypeConfig(orgType);
  const portalRoute = config?.portalRoute || "/org/default";

  redirect((portalRoute + "/" + orgId) as Route);
}

/**
 * @deprecated Use enterOrg instead. Kept for backward compatibility.
 */
export async function enterParcelOrg(orgId: string): Promise<void> {
  return enterOrg(orgId, "courier");
}
