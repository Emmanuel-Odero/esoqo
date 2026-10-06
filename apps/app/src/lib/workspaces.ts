import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { SESSION_COOKIE } from "@esoqo/auth";
import { listMyStores } from "@esoqo/db";
import { goUrl } from "./ticketing";
import { getCtx } from "./session";
import { getOrgTypeConfig, type WorkspaceKind } from "./org-type-config";

/**
 * Generic workspace interface that works for all org types.
 *
 * This replaces the courier-specific WorkspaceKind enum with a flexible
 * system that supports any org type (courier, hotel, eatery, chama, tout, etc.)
 * without component logic changes.
 */
export interface Workspace {
  /** Stable React key (format: "kind:id" or "personal") */
  key: string;

  /** Workspace kind: 'personal' or 'managed' (for any org type) */
  kind: WorkspaceKind;

  /** Organization ID (empty for personal) */
  id: string;

  /** Organization name */
  name: string;

  /** Display subtitle (org type label) */
  subtitle: string;

  /** Organization type (courier, hotel, eatery, chama, etc.) */
  orgType?: string;

  /**
   * Navigation href if available (direct entry).
   * Null if session needs to be minted first.
   */
  href: string | null;

  /** Whether this workspace can currently be entered */
  enterable: boolean;

  /** Why it can't be opened, or the person's role in it */
  note?: string;

  /** Session profile (shift, session, readonly) for timing info */
  sessionProfile?: string;
}

/**
 * Response from /v1/me/orgs API endpoint.
 */
interface MyOrgResponse {
  id: string;
  type: string;
  name: string;
  slug: string;
  status: string;
  role: string;
}

export const PERSONAL_WORKSPACE: Workspace = {
  key: "personal",
  kind: "personal",
  id: "",
  name: "Esoqo",
  subtitle: "Your own profile",
  href: "/me",
  enterable: true,
};

/**
 * Fetch all organizations a person is staff of (generic endpoint).
 * Works for all org types through a single API call.
 */
async function listMyOrgs(token: string): Promise<Workspace[]> {
  try {
    const res = await fetch(goUrl("/v1/me/orgs"), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];

    const json = (await res.json().catch(() => null)) as {
      orgs?: MyOrgResponse[] | null;
    } | null;

    return (json?.orgs ?? []).map((org): Workspace => {
      const config = getOrgTypeConfig(org.type);

      return {
        key: `${org.type}:${org.id}`,
        kind: "managed",
        id: org.id,
        name: org.name,
        orgType: org.type,
        subtitle: config?.label ?? org.type,
        href:
          config && config.entryType === "direct"
            ? config.portalRoute + "/" + org.id
            : null,
        enterable: org.status === "ACTIVE",
        note:
          org.status === "ACTIVE"
            ? org.role.toLowerCase().replace(/_/g, " ")
            : "not active yet",
        sessionProfile: config?.sessionProfile,
      };
    });
  } catch {
    return [];
  }
}

/**
 * A signed-in person's estores. Unlike courier/hotel/eatery orgs, a
 * Store has no org_staff row and needs no session minted — it's owned
 * directly by the person's own Party (via Enterprise), and apps/store's
 * dashboard already trusts the same SESSION_COOKIE. So this is a direct
 * link, same shape as PERSONAL_WORKSPACE, not a WorkspaceEnter button.
 *
 * apps/store's dashboard shows only the first store on the account, so
 * one or many stores still collapse to a single switcher entry — there
 * is nowhere in the URL yet to pick a specific one.
 */
async function listMyStoreWorkspaces(): Promise<Workspace[]> {
  const ctx = await getCtx();
  if (ctx.actorType !== "SUBJECT" || !ctx.partyId) return [];

  const stores = await listMyStores(ctx).catch(() => []);
  if (stores.length === 0) return [];

  const storeUrl = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3003";

  return [
    {
      key: "store",
      kind: "managed",
      id: stores[0]!.id,
      name: stores.length === 1 ? stores[0]!.name : "Your stores",
      subtitle: "Online store",
      href: `${storeUrl}/dashboard`,
      enterable: true,
      note: stores.length > 1 ? `${stores.length} stores` : undefined,
    },
  ];
}

/**
 * Best-effort throughout: a switcher that fails to render because one
 * optional backend read timed out would strand somebody mid-shift. The
 * generic API endpoint returns all org types, so a single outage affects
 * all orgs, but that's acceptable for best-effort. Cached per request.
 */
export const listWorkspaces = cache(async (): Promise<Workspace[]> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  // No personal session means this is a staff-only login (a rider who
  // came in through their employer's own door). They get no switcher —
  // there is nothing of their own to switch to.
  if (!token) return [];

  const [orgs, stores] = await Promise.all([
    listMyOrgs(token),
    listMyStoreWorkspaces(),
  ]);

  return [PERSONAL_WORKSPACE, ...orgs, ...stores];
});
